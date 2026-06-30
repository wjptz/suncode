import fs from "node:fs";
import path from "node:path";

import type {
  HubManifest,
  HubManifestArtifact,
  HubTaskMeta,
  ObjectRef,
} from "./types.js";

export const HUB_MANIFEST_FILE = "hub-manifest.json";
export const HUB_SPEC_MANIFEST_FILE = "hub-spec-manifest.json";

export function defaultHubManifest(): HubManifest {
  return { version: 1, artifacts: {} };
}

export function hubManifestPath(taskDir: string): string {
  return path.join(taskDir, HUB_MANIFEST_FILE);
}

export function projectSpecManifestPath(cwd: string): string {
  return path.join(cwd, ".suncode", HUB_SPEC_MANIFEST_FILE);
}

export function loadHubManifest(taskDir: string): HubManifest {
  const filePath = hubManifestPath(taskDir);
  return loadManifestFile(filePath);
}

export function loadProjectSpecManifest(cwd: string): HubManifest {
  return loadManifestFile(projectSpecManifestPath(cwd));
}

function loadManifestFile(filePath: string): HubManifest {
  if (!fs.existsSync(filePath)) return defaultHubManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<
      HubManifest
    >;
    return {
      ...defaultHubManifest(),
      ...parsed,
      version: 1,
      artifacts:
        parsed.artifacts && typeof parsed.artifacts === "object"
          ? parsed.artifacts
          : {},
    };
  } catch {
    return defaultHubManifest();
  }
}

export function saveHubManifest(taskDir: string, manifest: HubManifest): void {
  saveManifestFile(hubManifestPath(taskDir), manifest);
}

export function saveProjectSpecManifest(
  cwd: string,
  manifest: HubManifest,
): void {
  saveManifestFile(projectSpecManifestPath(cwd), manifest);
}

function saveManifestFile(filePath: string, manifest: HubManifest): void {
  const sanitized = sanitizeManifest(manifest);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(sanitized, null, 2)}\n`,
    "utf-8",
  );
}

export function upsertManifestArtifact(
  manifest: HubManifest,
  artifact: HubManifestArtifact,
): void {
  manifest.artifacts[artifact.path] = artifact;
}

export function syncManifestTaskBinding(
  manifest: HubManifest,
  data: {
    projectId: string;
    requirementId?: string;
    requirementRevision?: number;
    remoteTaskId: string;
    taskRole?: HubTaskMeta["taskRole"];
    parentRemoteTaskId?: string | null;
  },
): void {
  manifest.projectId = data.projectId;
  manifest.remoteTaskId = data.remoteTaskId;
  if (data.requirementId) manifest.requirementId = data.requirementId;
  if (data.requirementRevision !== undefined) {
    manifest.requirementRevision = data.requirementRevision;
  }
  if (data.taskRole) manifest.taskRole = data.taskRole;
  if (data.parentRemoteTaskId !== undefined) {
    manifest.parentRemoteTaskId = data.parentRemoteTaskId;
  }
}

function sanitizeManifest(manifest: HubManifest): HubManifest {
  return {
    ...manifest,
    version: 1,
    artifacts: Object.fromEntries(
      Object.entries(manifest.artifacts).map(([key, artifact]) => [
        key,
        sanitizeArtifact(artifact),
      ]),
    ),
  };
}

function sanitizeArtifact(artifact: HubManifestArtifact): HubManifestArtifact {
  const objectRef = sanitizeObjectRef(artifact.objectRef);
  return {
    path: artifact.path,
    type: artifact.type,
    lastSubmittedSha256: artifact.lastSubmittedSha256,
    size: artifact.size,
    ...(artifact.storage ? { storage: artifact.storage } : {}),
    ...(objectRef ? { objectRef } : {}),
    ...(artifact.uploadSessionId
      ? { uploadSessionId: artifact.uploadSessionId }
      : {}),
    ...(artifact.remoteArtifactId
      ? { remoteArtifactId: artifact.remoteArtifactId }
      : {}),
    ...(artifact.remoteRevision !== undefined
      ? { remoteRevision: artifact.remoteRevision }
      : {}),
  };
}

function sanitizeObjectRef(value: ObjectRef | undefined): ObjectRef | undefined {
  if (!value) return undefined;
  return {
    provider: value.provider,
    objectKey: value.objectKey,
    ...(value.versionId !== undefined ? { versionId: value.versionId } : {}),
  };
}
