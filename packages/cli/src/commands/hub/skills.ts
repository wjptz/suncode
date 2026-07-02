import fs from "node:fs";
import path from "node:path";

import { toPosix } from "../../utils/posix.js";
import {
  requestAgentHubJson,
  requestAgentHubRaw,
} from "./agent-hub-client.js";
import { resolveHubConfig } from "./config.js";
import type { EnabledHubConfig, FetchLike, HubCommandResult } from "./types.js";

const MAX_SKILL_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface HubSkillPackageOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  skillName: string;
}

interface LocalSkillFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  contentType: string;
}

interface PresignUploadResponse {
  presign: {
    upload_url: string;
    method?: string;
    object_key: string;
    headers?: Record<string, string>;
    expires_at?: string;
  };
}

interface FinalizeUploadResponse {
  skill_package?: SkillPackageDetail;
}

interface SkillPackageListResponse {
  skill_packages?: SkillPackageSummary[];
}

interface SkillPackageDetailResponse {
  skill_package?: SkillPackageDetail;
}

interface SkillPackageSummary {
  id?: string | number;
  scope?: string;
  project_key?: string;
  name?: string;
  file_count?: number;
}

interface SkillPackageDetail extends SkillPackageSummary {
  files?: SkillPackageFile[];
}

interface SkillPackageFile {
  id?: string | number;
  relative_path?: string;
  file_name?: string;
}

interface DownloadTarget {
  fileId: string;
  relativePath: string;
  targetPath: string;
}

export async function hubSkillPush(
  options: HubSkillPackageOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }

  const skillName = normalizeSkillName(options.skillName);
  const skillDir = resolveLocalSkillDir(cwd, skillName);
  const files = collectLocalSkillFiles(skillDir);
  const fetchImpl = options.fetch ?? fetch;

  for (const file of files) {
    const presign = await requestAgentHubJson<PresignUploadResponse>(
      config,
      "POST",
      "/skill-packages/presign-upload",
      {
        scope: "project",
        project_key: config.projectId,
        skill_name: skillName,
        file_path: file.relativePath,
        size: file.size,
        content_type: file.contentType,
      },
      fetchImpl,
      "skill package",
    );
    await uploadPresignedFile(file, presign, fetchImpl);
    await requestAgentHubJson<FinalizeUploadResponse>(
      config,
      "POST",
      "/skill-packages/finalize-upload",
      {
        scope: "project",
        project_key: config.projectId,
        skill_name: skillName,
        file_path: file.relativePath,
        object_key: presign.presign.object_key,
      },
      fetchImpl,
      "skill package",
    );
  }

  return {
    status: "submitted",
    message: `skill package ${skillName} uploaded (${files.length} file(s)).`,
  };
}

export async function hubSkillPull(
  options: HubSkillPackageOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }

  const skillName = normalizeSkillName(options.skillName);
  const fetchImpl = options.fetch ?? fetch;
  const list = await requestAgentHubJson<SkillPackageListResponse>(
    config,
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/skill-packages`,
    undefined,
    fetchImpl,
    "skill package",
  );
  const selected = selectSkillPackage(
    list.skill_packages ?? [],
    skillName,
    config.projectId,
  );
  const detail = await requestAgentHubJson<SkillPackageDetailResponse>(
    config,
    "GET",
    `/skill-packages/${encodeURIComponent(packageId(selected))}`,
    undefined,
    fetchImpl,
    "skill package",
  );
  const files = detail.skill_package?.files ?? [];
  const skillDir = resolveLocalSkillDir(cwd, skillName);
  const targets = files.map((file) => resolveDownloadTarget(skillDir, file));

  for (const target of targets) {
    const body = await downloadSkillFile(config, target.fileId, fetchImpl);
    fs.mkdirSync(path.dirname(target.targetPath), { recursive: true });
    fs.writeFileSync(target.targetPath, body);
  }

  return {
    status: "downloaded",
    message: `skill package ${skillName} downloaded (${targets.length} file(s)).`,
  };
}

function resolveLocalSkillDir(cwd: string, skillName: string): string {
  return path.join(cwd, ".agents", "skills", skillName);
}

function normalizeSkillName(value: string): string {
  const skillName = value.trim();
  if (
    !skillName ||
    skillName === "." ||
    skillName === ".." ||
    skillName.includes("/") ||
    skillName.includes("\\")
  ) {
    throw new Error(`Invalid skill name: ${value}`);
  }
  return skillName;
}

function collectLocalSkillFiles(skillDir: string): LocalSkillFile[] {
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    throw new Error(`Local skill directory not found: ${skillDir}`);
  }
  const skillMarkdown = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMarkdown) || !fs.statSync(skillMarkdown).isFile()) {
    throw new Error(`Local skill package must include ${skillMarkdown}`);
  }

  const files: LocalSkillFile[] = [];
  walkSkillDir(skillDir, skillDir, files);
  return files.sort(compareLocalSkillFiles);
}

function walkSkillDir(
  skillDir: string,
  currentDir: string,
  files: LocalSkillFile[],
): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkSkillDir(skillDir, fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;

    const size = fs.statSync(fullPath).size;
    if (size < 1 || size > MAX_SKILL_FILE_SIZE_BYTES) {
      throw new Error(
        `Skill package file size out of range: ${toPosix(path.relative(skillDir, fullPath))}`,
      );
    }
    const relativePath = toPosix(path.relative(skillDir, fullPath));
    files.push({
      absolutePath: fullPath,
      relativePath,
      size,
      contentType: guessContentType(relativePath),
    });
  }
}

function compareLocalSkillFiles(a: LocalSkillFile, b: LocalSkillFile): number {
  if (a.relativePath === "SKILL.md") return -1;
  if (b.relativePath === "SKILL.md") return 1;
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

async function uploadPresignedFile(
  file: LocalSkillFile,
  presignResponse: PresignUploadResponse,
  fetchImpl: FetchLike,
): Promise<void> {
  const presign = presignResponse.presign;
  if (!presign?.upload_url || !presign.object_key) {
    throw new Error(`Hub presign response missing upload URL for ${file.relativePath}`);
  }
  const response = await fetchImpl(presign.upload_url, {
    method: presign.method ?? "PUT",
    headers: presign.headers ?? { "Content-Type": file.contentType },
    body: fs.readFileSync(file.absolutePath),
  });
  if (!response.ok) {
    throw new Error(
      `MinIO upload failed for ${file.relativePath}: HTTP ${response.status}`,
    );
  }
}

function selectSkillPackage(
  packages: readonly SkillPackageSummary[],
  skillName: string,
  projectKey: string,
): SkillPackageSummary {
  const matches = packages.filter((pkg) => pkg.name === skillName);
  if (matches.length === 0) {
    throw new Error(`Hub skill package not found: ${skillName}`);
  }
  const projectMatches = matches.filter(
    (pkg) => pkg.scope === "project" && pkg.project_key === projectKey,
  );
  const candidates = projectMatches.length > 0 ? projectMatches : matches;
  if (candidates.length !== 1) {
    throw new Error(`Hub skill package name is ambiguous: ${skillName}`);
  }
  return candidates[0];
}

function packageId(pkg: SkillPackageSummary): string {
  if (typeof pkg.id === "string" && pkg.id.trim()) return pkg.id;
  if (typeof pkg.id === "number" && Number.isFinite(pkg.id)) return String(pkg.id);
  throw new Error("Hub skill package response is missing package id.");
}

function resolveDownloadTarget(
  skillDir: string,
  file: SkillPackageFile,
): DownloadTarget {
  const fileId = packageFileId(file);
  const relativePath = file.relative_path;
  if (!relativePath) {
    throw new Error(`Hub skill package file ${fileId} is missing relative_path.`);
  }
  const targetPath = safeSkillFilePath(skillDir, relativePath);
  return { fileId, relativePath, targetPath };
}

function packageFileId(file: SkillPackageFile): string {
  if (typeof file.id === "string" && file.id.trim()) return file.id;
  if (typeof file.id === "number" && Number.isFinite(file.id)) return String(file.id);
  throw new Error("Hub skill package file response is missing file id.");
}

function safeSkillFilePath(skillDir: string, relativePath: string): string {
  if (
    !relativePath.trim() ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid skill package file path: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid skill package file path: ${relativePath}`);
  }

  const root = path.resolve(skillDir);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid skill package file path: ${relativePath}`);
  }
  return target;
}

async function downloadSkillFile(
  config: EnabledHubConfig,
  fileId: string,
  fetchImpl: FetchLike,
): Promise<Buffer> {
  const response = await requestAgentHubRaw(
    config,
    "GET",
    `/skill-package-files/${encodeURIComponent(fileId)}/content`,
    undefined,
    fetchImpl,
    "skill package",
  );
  return Buffer.from(await response.arrayBuffer());
}
