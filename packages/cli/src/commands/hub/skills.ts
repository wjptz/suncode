import fs from "node:fs";
import path from "node:path";

import { toPosix } from "../../utils/posix.js";
import {
  requestAgentHubJson,
  requestAgentHubRaw,
} from "./agent-hub-client.js";
import { resolveHubConfig } from "./config.js";
import type { EnabledHubConfig, FetchLike, HubCommandResult } from "./types.js";

const MAX_PACKAGE_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface HubSkillPackageOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  skillName: string;
}

export interface HubAgentPackageOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  agentName: string;
}

interface HubPackageOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  packageName: string;
  packageConfig: HubPackageConfig;
}

interface HubPackageConfig {
  noun: "skill" | "agent";
  displayNoun: "skill package" | "agent package";
  local: HubPackageLocalConfig;
  nameField: "skill_name" | "agent_name";
  listKey: "skill_packages" | "agent_packages";
  detailKey: "skill_package" | "agent_package";
  presignPath: string;
  finalizePath: string;
  listPath(projectKey: string): string;
  detailPath(packageId: string): string;
  contentPath(fileId: string): string;
}

type HubPackageLocalConfig =
  | {
      layout: "directory";
      rootPathSegments: readonly string[];
      rootFileName: "SKILL.md";
    }
  | {
      layout: "single-agent-file";
      rootPathSegments: readonly string[];
      uploadFilePath: "AGENT.md";
      fallbackRootFileName: "AGENT.md";
    };

interface LocalPackageFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  contentType: string;
}

interface PresignUploadResponse {
  presign?: {
    upload_url?: string;
    method?: string;
    object_key?: string;
    headers?: Record<string, string>;
    expires_at?: string;
    upload_session_id?: string;
    upload_id?: string;
    file_ref?: string;
  };
}

interface UploadRefs {
  uploadSessionId: string;
  uploadId: string;
  fileRef: string;
}

interface FinalizeUploadResponse {
  skill_package?: HubPackageDetail;
  agent_package?: HubPackageDetail;
}

interface PackageListResponse {
  skill_packages?: HubPackageSummary[];
  agent_packages?: HubPackageSummary[];
}

interface PackageDetailResponse {
  skill_package?: HubPackageDetail;
  agent_package?: HubPackageDetail;
}

interface HubPackageSummary {
  id?: string | number;
  scope?: string;
  project_key?: string;
  name?: string;
  file_count?: number;
}

interface HubPackageDetail extends HubPackageSummary {
  files?: HubPackageFile[];
}

interface HubPackageFile {
  id?: string | number;
  relative_path?: string;
  file_name?: string;
}

interface DownloadTarget {
  fileId: string;
  relativePath: string;
  targetPath: string;
}

const SKILL_PACKAGE_CONFIG: HubPackageConfig = {
  noun: "skill",
  displayNoun: "skill package",
  local: {
    layout: "directory",
    rootPathSegments: [".agents", "skills"],
    rootFileName: "SKILL.md",
  },
  nameField: "skill_name",
  listKey: "skill_packages",
  detailKey: "skill_package",
  presignPath: "/skill-packages/presign-upload",
  finalizePath: "/skill-packages/finalize-upload",
  listPath: (projectKey: string): string =>
    `/projects/${encodeURIComponent(projectKey)}/skill-packages`,
  detailPath: (packageId: string): string =>
    `/skill-packages/${encodeURIComponent(packageId)}`,
  contentPath: (fileId: string): string =>
    `/files/skill-package-files/${encodeURIComponent(fileId)}/download`,
};

const AGENT_PACKAGE_CONFIG: HubPackageConfig = {
  noun: "agent",
  displayNoun: "agent package",
  local: {
    layout: "single-agent-file",
    rootPathSegments: [".suncode", "agents"],
    uploadFilePath: "AGENT.md",
    fallbackRootFileName: "AGENT.md",
  },
  nameField: "agent_name",
  listKey: "agent_packages",
  detailKey: "agent_package",
  presignPath: "/agent-packs/presign-upload",
  finalizePath: "/agent-packs/finalize-upload",
  listPath: (projectKey: string): string =>
    `/projects/${encodeURIComponent(projectKey)}/agent-packs`,
  detailPath: (packageId: string): string =>
    `/agent-packs/${encodeURIComponent(packageId)}`,
  contentPath: (fileId: string): string =>
    `/files/agent-pack-files/${encodeURIComponent(fileId)}/download`,
};

export async function hubSkillPush(
  options: HubSkillPackageOptions,
): Promise<HubCommandResult> {
  return pushHubPackage({
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    packageName: options.skillName,
    packageConfig: SKILL_PACKAGE_CONFIG,
  });
}

export async function hubSkillPull(
  options: HubSkillPackageOptions,
): Promise<HubCommandResult> {
  return pullHubPackage({
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    packageName: options.skillName,
    packageConfig: SKILL_PACKAGE_CONFIG,
  });
}

export async function hubAgentPush(
  options: HubAgentPackageOptions,
): Promise<HubCommandResult> {
  return pushHubPackage({
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    packageName: options.agentName,
    packageConfig: AGENT_PACKAGE_CONFIG,
  });
}

export async function hubAgentPull(
  options: HubAgentPackageOptions,
): Promise<HubCommandResult> {
  return pullHubPackage({
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    packageName: options.agentName,
    packageConfig: AGENT_PACKAGE_CONFIG,
  });
}

async function pushHubPackage(
  options: HubPackageOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const hubConfig = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!hubConfig.enabled) {
    return { status: "disabled", message: hubConfig.reason };
  }

  const packageName = normalizePackageName(
    options.packageName,
    options.packageConfig,
  );
  const files = collectLocalPackageFiles(
    cwd,
    packageName,
    options.packageConfig,
  );
  const fetchImpl = options.fetch ?? fetch;

  for (const file of files) {
    const presign = await requestAgentHubJson<PresignUploadResponse>(
      hubConfig,
      "POST",
      options.packageConfig.presignPath,
      {
        scope: "project",
        project_key: hubConfig.projectId,
        ...packageNamePayload(options.packageConfig, packageName),
        file_path: file.relativePath,
        size: file.size,
        content_type: file.contentType,
      },
      fetchImpl,
      options.packageConfig.displayNoun,
    );
    const uploadRefs = uploadRefsFromPresign(
      presign,
      file.relativePath,
      options.packageConfig,
    );
    await uploadPresignedFile(
      file,
      presign,
      hubConfig,
      fetchImpl,
      options.packageConfig,
    );
    await requestAgentHubJson<FinalizeUploadResponse>(
      hubConfig,
      "POST",
      options.packageConfig.finalizePath,
      {
        scope: "project",
        project_key: hubConfig.projectId,
        ...packageNamePayload(options.packageConfig, packageName),
        file_path: file.relativePath,
        upload_session_id: uploadRefs.uploadSessionId,
        upload_id: uploadRefs.uploadId,
        file_ref: uploadRefs.fileRef,
      },
      fetchImpl,
      options.packageConfig.displayNoun,
    );
  }

  return {
    status: "submitted",
    message: `${options.packageConfig.displayNoun} ${packageName} uploaded (${files.length} file(s)).`,
  };
}

async function pullHubPackage(
  options: HubPackageOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const hubConfig = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!hubConfig.enabled) {
    return { status: "disabled", message: hubConfig.reason };
  }

  const packageName = normalizePackageName(
    options.packageName,
    options.packageConfig,
  );
  const fetchImpl = options.fetch ?? fetch;
  const list = await requestAgentHubJson<PackageListResponse>(
    hubConfig,
    "GET",
    options.packageConfig.listPath(hubConfig.projectId),
    undefined,
    fetchImpl,
    options.packageConfig.displayNoun,
  );
  const selected = selectHubPackage(
    list[options.packageConfig.listKey] ?? [],
    packageName,
    hubConfig.projectId,
    options.packageConfig,
  );
  const detail = await requestAgentHubJson<PackageDetailResponse>(
    hubConfig,
    "GET",
    options.packageConfig.detailPath(
      packageId(selected, options.packageConfig),
    ),
    undefined,
    fetchImpl,
    options.packageConfig.displayNoun,
  );
  const files = detail[options.packageConfig.detailKey]?.files ?? [];
  const targets = resolveDownloadTargets(
    cwd,
    packageName,
    files,
    options.packageConfig,
  );

  for (const target of targets) {
    const body = await downloadPackageFile(
      hubConfig,
      target.fileId,
      fetchImpl,
      options.packageConfig,
    );
    fs.mkdirSync(path.dirname(target.targetPath), { recursive: true });
    fs.writeFileSync(target.targetPath, body);
  }

  return {
    status: "downloaded",
    message: `${options.packageConfig.displayNoun} ${packageName} downloaded (${targets.length} file(s)).`,
  };
}

function resolveLocalDirectoryPackageDir(
  cwd: string,
  packageName: string,
  packageConfig: HubPackageConfig,
): string {
  if (packageConfig.local.layout !== "directory") {
    throw new Error(`${packageConfig.displayNoun} is not a directory package.`);
  }
  return path.join(cwd, ...packageConfig.local.rootPathSegments, packageName);
}

function resolveLocalAgentFilePath(
  cwd: string,
  packageName: string,
  packageConfig: HubPackageConfig,
): string {
  if (packageConfig.local.layout !== "single-agent-file") {
    throw new Error(
      `${packageConfig.displayNoun} is not a single-file package.`,
    );
  }
  return path.join(
    cwd,
    ...packageConfig.local.rootPathSegments,
    `${packageName}.md`,
  );
}

function resolveNestedAgentFallbackPath(
  cwd: string,
  packageName: string,
  packageConfig: HubPackageConfig,
): string {
  if (packageConfig.local.layout !== "single-agent-file") {
    throw new Error(
      `${packageConfig.displayNoun} is not a single-file package.`,
    );
  }
  return path.join(
    cwd,
    ...packageConfig.local.rootPathSegments,
    packageName,
    packageConfig.local.fallbackRootFileName,
  );
}

function normalizePackageName(
  value: string,
  packageConfig: HubPackageConfig,
): string {
  const packageName = value.trim();
  if (
    !packageName ||
    packageName === "." ||
    packageName === ".." ||
    packageName.includes("/") ||
    packageName.includes("\\")
  ) {
    throw new Error(`Invalid ${packageConfig.noun} name: ${value}`);
  }
  return packageName;
}

function collectLocalPackageFiles(
  cwd: string,
  packageName: string,
  packageConfig: HubPackageConfig,
): LocalPackageFile[] {
  if (packageConfig.local.layout === "single-agent-file") {
    return collectLocalAgentFile(cwd, packageName, packageConfig);
  }

  const packageDir = resolveLocalDirectoryPackageDir(
    cwd,
    packageName,
    packageConfig,
  );
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error(
      `Local ${packageConfig.displayNoun} directory not found: ${packageDir}`,
    );
  }
  const rootFile = path.join(packageDir, packageConfig.local.rootFileName);
  if (!fs.existsSync(rootFile) || !fs.statSync(rootFile).isFile()) {
    throw new Error(
      `Local ${packageConfig.displayNoun} must include ${rootFile}`,
    );
  }

  const files: LocalPackageFile[] = [];
  walkPackageDir(packageDir, packageDir, files, packageConfig);
  return files.sort((a, b) => compareLocalPackageFiles(a, b, packageConfig));
}

function collectLocalAgentFile(
  cwd: string,
  packageName: string,
  packageConfig: HubPackageConfig,
): LocalPackageFile[] {
  if (packageConfig.local.layout !== "single-agent-file") {
    throw new Error(
      `${packageConfig.displayNoun} is not a single-file package.`,
    );
  }
  const defaultFile = resolveLocalAgentFilePath(
    cwd,
    packageName,
    packageConfig,
  );
  const fallbackFile = resolveNestedAgentFallbackPath(
    cwd,
    packageName,
    packageConfig,
  );
  const absolutePath = fs.existsSync(defaultFile) ? defaultFile : fallbackFile;
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(
      `Local ${packageConfig.displayNoun} markdown file not found: ${defaultFile} (fallback: ${fallbackFile})`,
    );
  }
  const size = fs.statSync(absolutePath).size;
  if (size < 1 || size > MAX_PACKAGE_FILE_SIZE_BYTES) {
    throw new Error(
      `${packageConfig.displayNoun} file size out of range: ${packageConfig.local.uploadFilePath}`,
    );
  }
  return [
    {
      absolutePath,
      relativePath: packageConfig.local.uploadFilePath,
      size,
      contentType: guessContentType(packageConfig.local.uploadFilePath),
    },
  ];
}

function walkPackageDir(
  packageDir: string,
  currentDir: string,
  files: LocalPackageFile[],
  packageConfig: HubPackageConfig,
): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkPackageDir(packageDir, fullPath, files, packageConfig);
      continue;
    }
    if (!entry.isFile()) continue;

    const size = fs.statSync(fullPath).size;
    if (size < 1 || size > MAX_PACKAGE_FILE_SIZE_BYTES) {
      throw new Error(
        `${packageConfig.displayNoun} file size out of range: ${toPosix(path.relative(packageDir, fullPath))}`,
      );
    }
    const relativePath = toPosix(path.relative(packageDir, fullPath));
    files.push({
      absolutePath: fullPath,
      relativePath,
      size,
      contentType: guessContentType(relativePath),
    });
  }
}

function compareLocalPackageFiles(
  a: LocalPackageFile,
  b: LocalPackageFile,
  packageConfig: HubPackageConfig,
): number {
  if (packageConfig.local.layout === "directory") {
    if (a.relativePath === packageConfig.local.rootFileName) return -1;
    if (b.relativePath === packageConfig.local.rootFileName) return 1;
  }
  return a.relativePath.localeCompare(b.relativePath);
}

function guessContentType(relativePath: string): string {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".py":
      return "text/x-python";
    case ".sh":
      return "application/x-sh";
    case ".yml":
    case ".yaml":
      return "application/yaml";
    default:
      return "application/octet-stream";
  }
}

function uploadRefsFromPresign(
  presignResponse: PresignUploadResponse,
  relativePath: string,
  packageConfig: HubPackageConfig,
): UploadRefs {
  const presign = presignResponse.presign;
  if (!presign?.upload_url) {
    throw new Error(
      `Hub presign response missing upload URL for ${relativePath}`,
    );
  }
  if (!presign.upload_session_id || !presign.upload_id || !presign.file_ref) {
    throw new Error(
      `Hub presign response missing upload refs for ${packageConfig.displayNoun} file ${relativePath}`,
    );
  }
  return {
    uploadSessionId: presign.upload_session_id,
    uploadId: presign.upload_id,
    fileRef: presign.file_ref,
  };
}

async function uploadPresignedFile(
  file: LocalPackageFile,
  presignResponse: PresignUploadResponse,
  hubConfig: EnabledHubConfig,
  fetchImpl: FetchLike,
  packageConfig: HubPackageConfig,
): Promise<void> {
  const presign = presignResponse.presign;
  if (!presign?.upload_url) {
    throw new Error(
      `Hub presign response missing upload URL for ${file.relativePath}`,
    );
  }
  const response = await fetchImpl(presign.upload_url, {
    method: presign.method ?? "PUT",
    headers: uploadHeaders(presign, file, hubConfig),
    body: fs.readFileSync(file.absolutePath),
  });
  if (!response.ok) {
    throw new Error(
      `Hub ${packageConfig.displayNoun} upload failed for ${file.relativePath}: HTTP ${response.status}`,
    );
  }
}

function uploadHeaders(
  presign: NonNullable<PresignUploadResponse["presign"]>,
  file: LocalPackageFile,
  hubConfig: EnabledHubConfig,
): Headers {
  const headers = new Headers(presign.headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("Content-Type", file.contentType);
  }
  if (
    hubConfig.token &&
    isAgentHubUploadUrl(presign.upload_url ?? "", hubConfig) &&
    !headers.has("authorization")
  ) {
    headers.set("Authorization", `Bearer ${hubConfig.token}`);
  }
  return headers;
}

function isAgentHubUploadUrl(
  uploadUrl: string,
  hubConfig: EnabledHubConfig,
): boolean {
  try {
    const url = new URL(uploadUrl);
    const base = new URL(hubConfig.apiBaseUrl);
    if (url.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, "");
    const agentHubPrefix = `${basePath}/api/agent-hub/`.replace(/^\/+/, "/");
    return url.pathname.startsWith(agentHubPrefix);
  } catch {
    return false;
  }
}

function selectHubPackage(
  packages: readonly HubPackageSummary[],
  packageName: string,
  projectKey: string,
  packageConfig: HubPackageConfig,
): HubPackageSummary {
  const matches = packages.filter((pkg) => pkg.name === packageName);
  if (matches.length === 0) {
    throw new Error(
      `Hub ${packageConfig.displayNoun} not found: ${packageName}`,
    );
  }
  const projectMatches = matches.filter(
    (pkg) => pkg.scope === "project" && pkg.project_key === projectKey,
  );
  const candidates = projectMatches.length > 0 ? projectMatches : matches;
  if (candidates.length !== 1) {
    throw new Error(
      `Hub ${packageConfig.displayNoun} name is ambiguous: ${packageName}`,
    );
  }
  return candidates[0];
}

function packageId(
  pkg: HubPackageSummary,
  packageConfig: HubPackageConfig,
): string {
  if (typeof pkg.id === "string" && pkg.id.trim()) return pkg.id;
  if (typeof pkg.id === "number" && Number.isFinite(pkg.id))
    return String(pkg.id);
  throw new Error(
    `Hub ${packageConfig.displayNoun} response is missing package id.`,
  );
}

function resolveDownloadTargets(
  cwd: string,
  packageName: string,
  files: readonly HubPackageFile[],
  packageConfig: HubPackageConfig,
): DownloadTarget[] {
  if (packageConfig.local.layout === "single-agent-file" && files.length > 1) {
    throw new Error(
      `Hub ${packageConfig.displayNoun} contains multiple files; agent-pull supports the default single markdown file layout.`,
    );
  }
  return files.map((file) =>
    resolveDownloadTarget(cwd, packageName, file, packageConfig),
  );
}

function resolveDownloadTarget(
  cwd: string,
  packageName: string,
  file: HubPackageFile,
  packageConfig: HubPackageConfig,
): DownloadTarget {
  const fileId = packageFileId(file, packageConfig);
  const relativePath = file.relative_path;
  if (!relativePath) {
    throw new Error(
      `Hub ${packageConfig.displayNoun} file ${fileId} is missing relative_path.`,
    );
  }
  const targetPath =
    packageConfig.local.layout === "single-agent-file"
      ? safeAgentFilePath(cwd, packageName, relativePath, packageConfig)
      : safePackageFilePath(
          resolveLocalDirectoryPackageDir(cwd, packageName, packageConfig),
          relativePath,
          packageConfig,
        );
  return { fileId, relativePath, targetPath };
}

function packageFileId(
  file: HubPackageFile,
  packageConfig: HubPackageConfig,
): string {
  if (typeof file.id === "string" && file.id.trim()) return file.id;
  if (typeof file.id === "number" && Number.isFinite(file.id))
    return String(file.id);
  throw new Error(
    `Hub ${packageConfig.displayNoun} file response is missing file id.`,
  );
}

function safePackageFilePath(
  packageDir: string,
  relativePath: string,
  packageConfig: HubPackageConfig,
): string {
  if (
    !relativePath.trim() ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }

  const root = path.resolve(packageDir);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }
  return target;
}

function safeAgentFilePath(
  cwd: string,
  packageName: string,
  relativePath: string,
  packageConfig: HubPackageConfig,
): string {
  if (packageConfig.local.layout !== "single-agent-file") {
    throw new Error(
      `${packageConfig.displayNoun} is not a single-file package.`,
    );
  }
  if (
    !relativePath.trim() ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }
  const parts = relativePath.split("/");
  if (
    parts.length !== 1 ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }
  const extension = path.posix.extname(parts[0] ?? "").toLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new Error(
      `Invalid ${packageConfig.displayNoun} file path: ${relativePath}`,
    );
  }
  return resolveLocalAgentFilePath(cwd, packageName, packageConfig);
}

async function downloadPackageFile(
  hubConfig: EnabledHubConfig,
  fileId: string,
  fetchImpl: FetchLike,
  packageConfig: HubPackageConfig,
): Promise<Buffer> {
  const response = await requestAgentHubRaw(
    hubConfig,
    "GET",
    packageConfig.contentPath(fileId),
    undefined,
    fetchImpl,
    packageConfig.displayNoun,
  );
  return Buffer.from(await response.arrayBuffer());
}

function packageNamePayload(
  packageConfig: HubPackageConfig,
  packageName: string,
): { skill_name: string } | { agent_name: string } {
  if (packageConfig.nameField === "skill_name") {
    return { skill_name: packageName };
  }
  return { agent_name: packageName };
}
