import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import { toPosix } from "../../utils/posix.js";
import { hashText, readNormalizedTextFile, textFileSize } from "./hash.js";
import { readHubTask } from "./task.js";
import type { HubArtifact } from "./types.js";

export interface CollectArtifactsOptions {
  cwd: string;
  taskJsonPath: string;
}

const PLAN_FILES: readonly {
  file: string;
  type: HubArtifact["type"];
}[] = [
  { file: "prd.md", type: "prd" },
  { file: "design.md", type: "design" },
  { file: "implement.md", type: "implement" },
];

const COMPLETION_FILES: readonly {
  file: string;
  type: HubArtifact["type"];
}[] = [
  { file: "implementation-summary.md", type: "implementation_summary" },
  { file: "validation-summary.md", type: "validation_summary" },
  { file: "retrospective.md", type: "retrospective" },
  { file: "reuse-assessment.md", type: "reuse_assessment" },
];

export function collectPlanArtifacts(
  options: CollectArtifactsOptions,
): HubArtifact[] {
  const task = readHubTask(options.taskJsonPath, options.cwd);
  const artifacts = PLAN_FILES.flatMap(({ file, type }) => {
    const absolutePath = path.join(task.taskDir, file);
    if (!fs.existsSync(absolutePath)) return [];
    return [artifactFromFile(file, type, absolutePath)];
  });

  const researchDir = path.join(task.taskDir, "research");
  if (fs.existsSync(researchDir)) {
    for (const file of listFiles(researchDir)) {
      const relative = toPosix(path.relative(task.taskDir, file));
      artifacts.push(artifactFromFile(relative, "research", file));
    }
  }

  return sortArtifacts(artifacts);
}

export function collectCompletionArtifacts(
  options: CollectArtifactsOptions,
): HubArtifact[] {
  const task = readHubTask(options.taskJsonPath, options.cwd);
  return sortArtifacts(
    COMPLETION_FILES.flatMap(({ file, type }) => {
      const absolutePath = path.join(task.taskDir, file);
      if (!fs.existsSync(absolutePath)) return [];
      return [artifactFromFile(file, type, absolutePath)];
    }),
  );
}

export function collectSpecArtifacts(
  cwd: string,
  explicitFiles: readonly string[] = [],
): HubArtifact[] {
  const specRoot = path.join(cwd, DIR_NAMES.WORKFLOW, DIR_NAMES.SPEC);
  const candidates =
    explicitFiles.length > 0
      ? explicitFiles.map((file) => path.resolve(cwd, file))
      : fs.existsSync(specRoot)
        ? listFiles(specRoot)
        : [];

  const artifacts = candidates
    .filter((file) => isInside(cwd, file))
    .filter((file) => isInside(specRoot, file))
    .map((file) =>
      artifactFromFile(toPosix(path.relative(cwd, file)), "spec", file),
    );
  return sortArtifacts(artifacts);
}

export function filterChangedArtifacts(
  artifacts: readonly HubArtifact[],
  lastSubmitted: Record<string, string | undefined>,
): HubArtifact[] {
  return artifacts.filter(
    (artifact) => lastSubmitted[artifact.path] !== artifact.sha256,
  );
}

export function artifactFromFile(
  relativePath: string,
  type: HubArtifact["type"],
  absolutePath: string,
): HubArtifact {
  const normalized = readNormalizedTextFile(absolutePath);
  return {
    path: toPosix(relativePath),
    type,
    absolutePath,
    sha256: hashText(normalized),
    size: textFileSize(normalized),
    contentType: contentTypeForPath(absolutePath),
  };
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "hub-sources" || entry.name === ".git") continue;
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  if (ext === ".json") return "application/json";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function sortArtifacts(artifacts: HubArtifact[]): HubArtifact[] {
  return [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
