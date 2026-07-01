import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import { toPosix } from "../../utils/posix.js";
import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { hashText, normalizeText, textFileSize } from "./hash.js";
import type { FetchLike, HubCommandResult } from "./types.js";

const SPEC_POLICY = "remote_wins";
const HUB_SPECS_MANIFEST = "hub-specs.json";
const HUB_SPEC_DELETIONS_DIR = "hub-spec-deletions";

interface HubSpecBundleFile {
  path: string;
  sha256?: string;
  size?: number;
  contentType?: string;
  download?: unknown;
  objectRef?: unknown;
}

interface HubSpecBundleFileDownload {
  url: string;
  method?: "GET";
  headers?: Record<string, string>;
}

interface HubSpecBundle {
  revision?: string;
  etag?: string;
  bundleHash?: string;
  basePath?: string;
  files?: unknown;
  deleted?: unknown;
}

interface RemoteSpecFile {
  logicalPath: string;
  sha256: string;
  content: string;
}

export interface HubSpecSyncManifest {
  version: 1;
  projectId?: string;
  apiBaseUrl?: string;
  policy: typeof SPEC_POLICY;
  revision?: string;
  etag?: string;
  bundleHash?: string;
  syncedAt?: string;
  files: Record<string, { sha256: string; managedBy: "hub" }>;
}

export interface HubSpecDeletionItem {
  id: string;
  previousPath: string;
  backupPath: string;
  previousSha256: string;
  reason: string;
  status: "pending" | "kept" | "discarded";
  keptPath?: string;
  keptAt?: string;
  discardedAt?: string;
}

export interface HubSpecDeletionManifest {
  version: 1;
  revision: string;
  deletedAt: string;
  items: HubSpecDeletionItem[];
}

export interface HubSpecSyncResult extends HubCommandResult {
  status: "disabled" | "skipped" | "updated";
  policy: typeof SPEC_POLICY;
  revision?: string;
  bundleHash?: string;
  actions: {
    added: string[];
    updated: string[];
    deleted: string[];
    unchanged: number;
  };
  localOnly: string[];
  deletionCandidates: Pick<
    HubSpecDeletionItem,
    "id" | "previousPath" | "backupPath"
  >[];
}

export interface HubSpecStateSummary {
  status:
    | "unknown"
    | "synced"
    | "synced-with-local-only"
    | "deletion-candidates";
  policy: typeof SPEC_POLICY;
  localRevision?: string;
  bundleHash?: string;
  syncedAt?: string;
  localOnlyCount: number;
  deletionCandidateCount: number;
}

export interface HubSpecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
}

export interface SpecDeletionOptions {
  cwd?: string;
}

export interface KeepSpecDeletionOptions extends SpecDeletionOptions {
  id: string;
  asPath: string;
}

export interface DiscardSpecDeletionOptions extends SpecDeletionOptions {
  id: string;
}

export function hubSpecSyncManifestPath(cwd: string): string {
  return path.join(cwd, DIR_NAMES.WORKFLOW, ".runtime", HUB_SPECS_MANIFEST);
}

export function loadHubSpecSyncManifest(cwd: string): HubSpecSyncManifest {
  const filePath = hubSpecSyncManifestPath(cwd);
  if (!fs.existsSync(filePath)) return defaultHubSpecSyncManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<
      HubSpecSyncManifest
    >;
    const files =
      parsed.files && typeof parsed.files === "object" ? parsed.files : {};
    return {
      ...parsed,
      version: 1,
      policy: SPEC_POLICY,
      files: sanitizeManifestFiles(files),
    };
  } catch {
    return defaultHubSpecSyncManifest();
  }
}

export async function pullHubSpecs(
  options: HubSpecOptions = {},
): Promise<HubSpecSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    return {
      status: "disabled",
      policy: SPEC_POLICY,
      actions: emptyActions(),
      localOnly: [],
      deletionCandidates: [],
      message: config.reason,
    };
  }

  const client = createHubApiClient(config, options.fetch);
  const bundle = await normalizeBundle(
    await client.requestJson<unknown>(
      "GET",
      `/projects/${encodeURIComponent(config.projectId)}/specs/bundle`,
    ),
    options.fetch ?? fetch,
  );
  const previousManifest = loadHubSpecSyncManifest(cwd);
  const remote = new Map<string, RemoteSpecFile>();
  for (const file of bundle.files) {
    if (remote.has(file.logicalPath)) {
      throw new Error(`Duplicate Hub spec path: ${file.logicalPath}`);
    }
    remote.set(file.logicalPath, file);
  }

  const localFiles = new Set(listSpecFiles(cwd));
  const previousFiles = new Set(Object.keys(previousManifest.files));
  const remoteFiles = new Set(remote.keys());
  const actions = emptyActions();
  const deletionCandidates: HubSpecSyncResult["deletionCandidates"] = [];
  const revision = bundle.revision ?? new Date().toISOString();

  for (const [logicalPath, file] of [...remote.entries()].sort()) {
    const absolutePath = absoluteSpecPath(cwd, logicalPath);
    if (!fs.existsSync(absolutePath)) {
      actions.added.push(logicalPath);
    } else if (hashText(fs.readFileSync(absolutePath, "utf-8")) !== file.sha256) {
      actions.updated.push(logicalPath);
    } else {
      actions.unchanged += 1;
    }
  }

  for (const logicalPath of [...previousFiles].sort()) {
    if (remoteFiles.has(logicalPath)) continue;
    actions.deleted.push(logicalPath);
    const absolutePath = absoluteSpecPath(cwd, logicalPath);
    if (fs.existsSync(absolutePath)) {
      const candidate = preserveDeletedSpec(cwd, revision, logicalPath);
      deletionCandidates.push({
        id: candidate.id,
        previousPath: candidate.previousPath,
        backupPath: candidate.backupPath,
      });
      fs.rmSync(absolutePath);
    }
  }

  const localOnly = [...localFiles]
    .filter((logicalPath) => !previousFiles.has(logicalPath))
    .filter((logicalPath) => !remoteFiles.has(logicalPath))
    .sort();

  for (const file of remote.values()) {
    const absolutePath = absoluteSpecPath(cwd, file.logicalPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, normalizeText(file.content), "utf-8");
  }

  saveHubSpecSyncManifest(cwd, {
    version: 1,
    projectId: config.projectId,
    apiBaseUrl: config.apiBaseUrl,
    policy: SPEC_POLICY,
    revision: bundle.revision,
    etag: bundle.etag,
    bundleHash: bundle.bundleHash,
    syncedAt: new Date().toISOString(),
    files: Object.fromEntries(
      [...remote.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([logicalPath, file]) => [
          logicalPath,
          { sha256: file.sha256, managedBy: "hub" as const },
        ]),
    ),
  });

  return {
    status: "updated",
    policy: SPEC_POLICY,
    revision: bundle.revision,
    bundleHash: bundle.bundleHash,
    actions,
    localOnly,
    deletionCandidates,
    message: "Hub specs synced. Remote spec is authoritative.",
  };
}

export function readHubSpecState(cwd: string): HubSpecStateSummary {
  const manifest = loadHubSpecSyncManifest(cwd);
  if (!manifest.syncedAt && !manifest.revision && Object.keys(manifest.files).length === 0) {
    return {
      status: "unknown",
      policy: SPEC_POLICY,
      localOnlyCount: 0,
      deletionCandidateCount: countPendingSpecDeletions(cwd),
    };
  }
  const localFiles = new Set(listSpecFiles(cwd));
  const managedFiles = new Set(Object.keys(manifest.files));
  const localOnlyCount = [...localFiles].filter(
    (logicalPath) => !managedFiles.has(logicalPath),
  ).length;
  const deletionCandidateCount = countPendingSpecDeletions(cwd);
  const status =
    localOnlyCount > 0
      ? "synced-with-local-only"
      : deletionCandidateCount > 0
        ? "deletion-candidates"
        : "synced";
  return {
    status,
    policy: SPEC_POLICY,
    ...(manifest.revision ? { localRevision: manifest.revision } : {}),
    ...(manifest.bundleHash ? { bundleHash: manifest.bundleHash } : {}),
    ...(manifest.syncedAt ? { syncedAt: manifest.syncedAt } : {}),
    localOnlyCount,
    deletionCandidateCount,
  };
}

export function listSpecDeletions(
  options: SpecDeletionOptions = {},
): {
  status: "skipped" | "updated";
  message: string;
  items: HubSpecDeletionItem[];
} {
  const cwd = options.cwd ?? process.cwd();
  const items = loadAllDeletionItems(cwd).map((e) => e.item);
  return {
    status: "updated",
    message: `${items.length} spec deletion candidate(s).`,
    items,
  };
}

export async function keepSpecDeletion(
  options: KeepSpecDeletionOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const found = findDeletionItem(cwd, options.id);
  const targetLogicalPath = normalizeLocalOnlyTargetPath(options.asPath);
  const sourcePath = path.join(cwd, ...found.item.backupPath.split("/"));
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Deletion candidate backup not found: ${found.item.backupPath}`);
  }

  const targetPath = path.join(cwd, ...targetLogicalPath.split("/"));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const original = fs.readFileSync(sourcePath, "utf-8");
  fs.writeFileSync(targetPath, localSupplementText(original), "utf-8");
  found.item.status = "kept";
  found.item.keptPath = targetLogicalPath;
  found.item.keptAt = new Date().toISOString();
  saveDeletionManifest(found.manifestPath, found.manifest);
  return {
    status: "updated",
    message: `已保留删除候选到 ${targetLogicalPath}`,
  };
}

export async function discardSpecDeletion(
  options: DiscardSpecDeletionOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const found = findDeletionItem(cwd, options.id);
  found.item.status = "discarded";
  found.item.discardedAt = new Date().toISOString();
  saveDeletionManifest(found.manifestPath, found.manifest);
  return {
    status: "updated",
    message: `已丢弃删除候选 ${options.id}`,
  };
}

async function normalizeBundle(
  value: unknown,
  fetchImpl: FetchLike,
): Promise<{
  revision?: string;
  etag?: string;
  bundleHash?: string;
  files: RemoteSpecFile[];
}> {
  if (!value || typeof value !== "object") {
    throw new Error("Hub spec bundle response must be an object.");
  }
  const bundle = value as HubSpecBundle;
  if (!Array.isArray(bundle.files)) {
    throw new Error("Hub spec bundle files must be an array.");
  }
  return {
    ...(stringField(bundle.revision) ? { revision: stringField(bundle.revision) } : {}),
    ...(stringField(bundle.etag) ? { etag: stringField(bundle.etag) } : {}),
    ...(stringField(bundle.bundleHash)
      ? { bundleHash: stringField(bundle.bundleHash) }
      : {}),
    files: await Promise.all(
      bundle.files.map((file) =>
        normalizeBundleFile(file, bundle.basePath, fetchImpl),
      ),
    ),
  };
}

async function normalizeBundleFile(
  value: unknown,
  basePath: string | undefined,
  fetchImpl: FetchLike,
): Promise<RemoteSpecFile> {
  if (!value || typeof value !== "object") {
    throw new Error("Hub spec bundle file must be an object.");
  }
  const file = value as HubSpecBundleFile;
  const logicalPath = normalizeSpecLogicalPath(file.path, basePath);
  const content = await downloadSpecFileContent(
    logicalPath,
    normalizeSpecDownload(file.download, logicalPath),
    fetchImpl,
  );
  const sha256 = normalizeSha256(file.sha256);
  const actualSha256 = hashText(content);
  if (sha256 && sha256 !== actualSha256) {
    throw new Error(`Hub spec bundle sha256 mismatch for ${logicalPath}.`);
  }
  if (file.size !== undefined && file.size !== textFileSize(content)) {
    throw new Error(`Hub spec bundle size mismatch for ${logicalPath}.`);
  }
  return { logicalPath, sha256: actualSha256, content: normalizeText(content) };
}

function normalizeSpecDownload(
  value: unknown,
  logicalPath: string,
): HubSpecBundleFileDownload {
  if (!value || typeof value !== "object") {
    throw new Error(
      `Hub spec bundle file download is required for ${logicalPath}.`,
    );
  }
  const record = value as Record<string, unknown>;
  const url = stringField(record.url);
  if (!url) {
    throw new Error(
      `Hub spec bundle file download.url must be a string for ${logicalPath}.`,
    );
  }
  const method = record.method === "GET" ? "GET" : undefined;
  const headers =
    record.headers && typeof record.headers === "object"
      ? sanitizeStringRecord(record.headers)
      : undefined;
  return {
    url,
    ...(method ? { method } : {}),
    ...(headers ? { headers } : {}),
  };
}

async function downloadSpecFileContent(
  logicalPath: string,
  download: HubSpecBundleFileDownload,
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(download.url, {
    method: download.method ?? "GET",
    ...(download.headers ? { headers: download.headers } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `MinIO download failed for Hub spec ${logicalPath}: HTTP ${response.status}`,
    );
  }
  return response.text();
}

function normalizeSpecLogicalPath(rawPath: unknown, basePath?: string): string {
  const value = stringField(rawPath);
  if (!value) throw new Error("Hub spec bundle file path is required.");
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`Invalid Hub spec path: ${value}`);
  }
  let normalized = toPosix(value).replace(/^\/+/, "");
  const normalizedBase = stringField(basePath)
    ? toPosix(stringField(basePath) ?? "").replace(/^\/+/, "").replace(/\/+$/, "")
    : "";
  if (normalizedBase && normalized.startsWith(`${normalizedBase}/`)) {
    normalized = normalized.slice(normalizedBase.length + 1);
  }
  if (normalized.startsWith(`${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}/`)) {
    normalized = normalized.slice(`${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}/`.length);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid Hub spec path: ${value}`);
  }
  return `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}/${parts.join("/")}`;
}

function normalizeLocalOnlyTargetPath(rawPath: string): string {
  const logicalPath = normalizeSpecLogicalPath(rawPath);
  const prefix = `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}/local/`;
  if (!logicalPath.startsWith(prefix)) {
    throw new Error(`Deletion candidates can only be kept under ${prefix}`);
  }
  return logicalPath;
}

function absoluteSpecPath(cwd: string, logicalPath: string): string {
  const absolute = path.join(cwd, ...logicalPath.split("/"));
  const specRoot = path.join(cwd, DIR_NAMES.WORKFLOW, DIR_NAMES.SPEC);
  if (!isInsideOrEqual(specRoot, absolute)) {
    throw new Error(`Invalid Hub spec path: ${logicalPath}`);
  }
  return absolute;
}

function listSpecFiles(cwd: string): string[] {
  const specRoot = path.join(cwd, DIR_NAMES.WORKFLOW, DIR_NAMES.SPEC);
  if (!fs.existsSync(specRoot)) return [];
  return listFiles(specRoot).map((file) => toPosix(path.relative(cwd, file))).sort();
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function preserveDeletedSpec(
  cwd: string,
  revision: string,
  logicalPath: string,
): HubSpecDeletionItem {
  const sourcePath = absoluteSpecPath(cwd, logicalPath);
  const content = fs.readFileSync(sourcePath, "utf-8");
  const specPrefix = `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}/`;
  const backupRelative = logicalPath.startsWith(specPrefix)
    ? logicalPath.slice(specPrefix.length)
    : logicalPath;
  const safeRevision = sanitizePathSegment(revision);
  const backupPath = toPosix(
    path.join(
      DIR_NAMES.WORKFLOW,
      ".runtime",
      HUB_SPEC_DELETIONS_DIR,
      safeRevision,
      backupRelative,
    ),
  );
  const absoluteBackupPath = path.join(cwd, ...backupPath.split("/"));
  fs.mkdirSync(path.dirname(absoluteBackupPath), { recursive: true });
  fs.writeFileSync(absoluteBackupPath, content, "utf-8");

  const manifestPath = path.join(
    cwd,
    DIR_NAMES.WORKFLOW,
    ".runtime",
    HUB_SPEC_DELETIONS_DIR,
    safeRevision,
    "manifest.json",
  );
  const manifest = loadDeletionManifest(manifestPath, revision);
  const id = `del_${hashText(`${revision}:${logicalPath}`).slice(0, 12)}`;
  const existing = manifest.items.find((item) => item.id === id);
  const item: HubSpecDeletionItem =
    existing ??
    {
      id,
      previousPath: logicalPath,
      backupPath,
      previousSha256: hashText(content),
      reason: "remote deleted this Hub-managed spec",
      status: "pending",
    };
  if (!existing) manifest.items.push(item);
  saveDeletionManifest(manifestPath, manifest);
  return item;
}

function loadDeletionManifest(
  filePath: string,
  revision: string,
): HubSpecDeletionManifest {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      revision,
      deletedAt: new Date().toISOString(),
      items: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<
      HubSpecDeletionManifest
    >;
    return {
      version: 1,
      revision: parsed.revision ?? revision,
      deletedAt: parsed.deletedAt ?? new Date().toISOString(),
      items: Array.isArray(parsed.items)
        ? parsed.items.filter(isDeletionItem)
        : [],
    };
  } catch {
    return {
      version: 1,
      revision,
      deletedAt: new Date().toISOString(),
      items: [],
    };
  }
}

function saveDeletionManifest(
  filePath: string,
  manifest: HubSpecDeletionManifest,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        revision: manifest.revision,
        deletedAt: manifest.deletedAt,
        items: manifest.items,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function loadAllDeletionItems(
  cwd: string,
): { item: HubSpecDeletionItem; manifest: HubSpecDeletionManifest; manifestPath: string }[] {
  const root = path.join(
    cwd,
    DIR_NAMES.WORKFLOW,
    ".runtime",
    HUB_SPEC_DELETIONS_DIR,
  );
  if (!fs.existsSync(root)) return [];
  const result: {
    item: HubSpecDeletionItem;
    manifest: HubSpecDeletionManifest;
    manifestPath: string;
  }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = loadDeletionManifest(manifestPath, entry.name);
    for (const item of manifest.items) {
      result.push({ item, manifest, manifestPath });
    }
  }
  return result.sort((a, b) => a.item.id.localeCompare(b.item.id));
}

function findDeletionItem(
  cwd: string,
  id: string,
): {
  item: HubSpecDeletionItem;
  manifest: HubSpecDeletionManifest;
  manifestPath: string;
} {
  const found = loadAllDeletionItems(cwd).find((entry) => entry.item.id === id);
  if (!found) throw new Error(`Spec deletion candidate not found: ${id}`);
  return found;
}

function countPendingSpecDeletions(cwd: string): number {
  return loadAllDeletionItems(cwd).filter(
    ({ item }) => item.status === "pending",
  ).length;
}

function saveHubSpecSyncManifest(
  cwd: string,
  manifest: HubSpecSyncManifest,
): void {
  const filePath = hubSpecSyncManifestPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

function defaultHubSpecSyncManifest(): HubSpecSyncManifest {
  return { version: 1, policy: SPEC_POLICY, files: {} };
}

function sanitizeManifestFiles(
  value: Record<string, { sha256?: unknown; managedBy?: unknown }>,
): HubSpecSyncManifest["files"] {
  return Object.fromEntries(
    Object.entries(value).flatMap(([logicalPath, file]) => {
      const sha256 = normalizeSha256(file?.sha256);
      if (!sha256) return [];
      return [[toPosix(logicalPath), { sha256, managedBy: "hub" as const }]];
    }),
  );
}

function normalizeSha256(value: unknown): string | undefined {
  const raw = stringField(value);
  if (!raw) return undefined;
  return raw.startsWith("sha256:") ? raw.slice("sha256:".length) : raw;
}

function emptyActions(): HubSpecSyncResult["actions"] {
  return { added: [], updated: [], deleted: [], unchanged: 0 };
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return sanitized || `spec_${hashText(value).slice(0, 12)}`;
}

function localSupplementText(content: string): string {
  return [
    "# 本地补充：Hub 删除候选",
    "",
    "> 来源：Hub spec 删除候选。",
    "> 约束：这是本地补充，不是 Hub 权威规范；如与 Hub spec 冲突，以 Hub spec 为准。",
    "",
    normalizeText(content).trimEnd(),
    "",
  ].join("\n");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeStringRecord(value: object): Record<string, string> | undefined {
  const entries = Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "string" ? [[key, entry] as const] : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isDeletionItem(value: unknown): value is HubSpecDeletionItem {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.previousPath === "string" &&
    typeof record.backupPath === "string" &&
    typeof record.previousSha256 === "string" &&
    typeof record.reason === "string" &&
    (record.status === "pending" ||
      record.status === "kept" ||
      record.status === "discarded")
  );
}
