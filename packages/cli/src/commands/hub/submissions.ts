import fs from "node:fs";
import path from "node:path";

import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import {
  collectCompletionArtifacts,
  collectPlanArtifacts,
  collectSpecArtifacts,
  filterChangedArtifacts,
} from "./artifacts.js";
import { hashArtifactBundle, hashText } from "./hash.js";
import {
  loadHubManifest,
  loadProjectSpecManifest,
  saveProjectSpecManifest,
  saveHubManifest,
  syncManifestTaskBinding,
  upsertManifestArtifact,
} from "./manifest.js";
import { uploadArtifactToMinio, type UploadTarget } from "./minio.js";
import { readHubTask } from "./task.js";
import type {
  FetchLike,
  HubArtifact,
  HubCommandResult,
  HubManifest,
  UploadedArtifact,
} from "./types.js";

export interface SubmitArtifactsOptions {
  cwd?: string;
  taskJsonPath: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  force?: boolean;
}

export interface SubmitSpecOptions extends SubmitArtifactsOptions {
  files?: readonly string[];
}

export interface HubStructuredSubtask {
  priority: string;
  name: string;
  description: string;
}

interface UploadSessionResponse {
  uploadSession: {
    id: string;
    expiresAt?: string;
    artifactBundleHash?: string;
  };
  uploads: UploadTarget[];
}

interface SubmissionResponse {
  submission?: {
    id: string;
    remoteRevision?: number;
    reviewStatus?: string;
    taskStatus?: string;
    createdAt?: string;
  };
  artifacts?: {
    path: string;
    remoteArtifactId?: string;
    remoteRevision?: number;
    sha256: string;
    storage?: "minio";
    objectRef?: UploadedArtifact["objectRef"];
  }[];
}

interface SubtasksSubmissionResponse {
  submission?: {
    id: string;
    remoteRevision?: number;
    createdAt?: string;
  };
  subtasks?: {
    remoteSubtaskId?: string;
    name: string;
  }[];
}

export async function submitPlan(
  options: SubmitArtifactsOptions,
): Promise<HubCommandResult> {
  return submitArtifacts({
    ...options,
    submissionKind: "plan",
    collect: (cwd, taskJsonPath) => collectPlanArtifacts({ cwd, taskJsonPath }),
  });
}

export async function submitSpec(
  options: SubmitSpecOptions,
): Promise<HubCommandResult> {
  return submitArtifacts({
    ...options,
    submissionKind: "spec",
    collect: (cwd) => collectSpecArtifacts(cwd, options.files ?? []),
  });
}

export async function submitCompletion(
  options: SubmitArtifactsOptions,
): Promise<HubCommandResult> {
  return submitArtifacts({
    ...options,
    submissionKind: "completion",
    collect: (cwd, taskJsonPath) =>
      collectCompletionArtifacts({ cwd, taskJsonPath }),
  });
}

export async function submitSubtasks(
  options: SubmitArtifactsOptions,
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

  const task = readHubTask(options.taskJsonPath, cwd);
  const manifest = loadHubManifest(task.taskDir);
  const remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (!remoteTaskId) {
    return {
      status: "skipped",
      message: "Task is not bound to a remote Hub task.",
    };
  }

  const subtasks = readStructuredSubtasks(task.taskDir);
  if (subtasks.length === 0) {
    return { status: "skipped", message: "No structured subtasks found." };
  }

  const subtasksHash = hashText(JSON.stringify({ version: 1, subtasks }));
  if (!options.force && manifest.lastSubtasksHash === subtasksHash) {
    return { status: "skipped", message: "No changed subtasks." };
  }

  const client = createHubApiClient(config, options.fetch);
  const submission = await client.requestJson<SubtasksSubmissionResponse>(
    "POST",
    `/projects/${encodeURIComponent(config.projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/subtasks`,
    {
      developerId: task.meta.developerId ?? config.developerId,
      requirementId: task.meta.requirementId ?? manifest.requirementId,
      requirementRevision:
        task.meta.requirementRevision ?? manifest.requirementRevision,
      localTaskId: task.localTaskId,
      localTaskPath: task.localTaskPath,
      subtasksHash,
      subtasks,
    },
    ["hub:submit-subtasks", remoteTaskId, subtasksHash].join(":"),
  );

  syncManifestTaskBinding(manifest, {
    projectId: config.projectId,
    requirementId: task.meta.requirementId ?? manifest.requirementId,
    requirementRevision:
      task.meta.requirementRevision ?? manifest.requirementRevision,
    remoteTaskId,
    taskRole: task.meta.taskRole ?? manifest.taskRole,
    parentRemoteTaskId:
      task.meta.parentRemoteTaskId ?? manifest.parentRemoteTaskId ?? null,
  });
  manifest.lastSubtasksHash = subtasksHash;
  if (submission.submission?.id) {
    manifest.lastSubtasksSubmissionId = submission.submission.id;
  }
  if (submission.submission?.remoteRevision !== undefined) {
    manifest.lastSubtasksRevision = submission.submission.remoteRevision;
  }
  saveHubManifest(task.taskDir, manifest);

  return {
    status: "submitted",
    message: `subtasks submitted (${subtasks.length} subtask(s)).`,
  };
}

async function submitArtifacts(
  options: SubmitArtifactsOptions & {
    submissionKind: "plan" | "spec" | "completion";
    collect: (cwd: string, taskJsonPath: string) => HubArtifact[];
  },
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

  const task = readHubTask(options.taskJsonPath, cwd);
  const taskManifest = loadHubManifest(task.taskDir);
  const artifactManifest =
    options.submissionKind === "spec"
      ? loadProjectSpecManifest(cwd)
      : taskManifest;
  const remoteTaskId = task.meta.remoteTaskId ?? taskManifest.remoteTaskId;
  if (!remoteTaskId) {
    return {
      status: "skipped",
      message: "Task is not bound to a remote Hub task.",
    };
  }

  const artifacts = options.collect(cwd, task.taskJsonPath);
  if (artifacts.length === 0) {
    return { status: "skipped", message: "No artifacts found." };
  }

  const changed = options.force
    ? artifacts
    : filterChangedArtifacts(artifacts, currentHashes(artifactManifest));
  if (changed.length === 0) {
    return { status: "skipped", message: "No changed artifacts." };
  }

  const bundleHash = hashArtifactBundle(changed);
  const client = createHubApiClient(config, options.fetch);
  const uploadSession = await createUploadSession({
    client,
    configProjectId: config.projectId,
    remoteTaskId,
    developerId: task.meta.developerId ?? config.developerId,
    localTaskId: task.localTaskId,
    localTaskPath: task.localTaskPath,
    artifactScope:
      options.submissionKind === "spec" ? "project_spec" : "current_task",
    submissionKind: options.submissionKind,
    artifactBundleHash: bundleHash,
    artifacts: changed,
  });

  const uploaded = await uploadAllArtifacts(
    changed,
    uploadSession,
    options.fetch ?? fetch,
  );

  const submission = await submitUploadedArtifacts({
    client,
    projectId: config.projectId,
    remoteTaskId,
    developerId: task.meta.developerId ?? config.developerId,
    requirementId: task.meta.requirementId ?? taskManifest.requirementId,
    requirementRevision:
      task.meta.requirementRevision ?? taskManifest.requirementRevision,
    localTaskId: task.localTaskId,
    localTaskPath: task.localTaskPath,
    submissionKind: options.submissionKind,
    artifactScope:
      options.submissionKind === "spec" ? "project_spec" : "current_task",
    bundleHash,
    uploadSessionId: uploadSession.uploadSession.id,
    artifacts: uploaded,
    manifest: artifactManifest,
    taskSummary: {
      status: stringField(task.task.status),
      commit: stringField(task.task.commit),
      prUrl: stringField(task.task.pr_url),
    },
  });

  if (options.submissionKind === "spec") {
    artifactManifest.projectId = config.projectId;
  } else {
    syncManifestTaskBinding(taskManifest, {
      projectId: config.projectId,
      requirementId: task.meta.requirementId ?? taskManifest.requirementId,
      requirementRevision:
        task.meta.requirementRevision ?? taskManifest.requirementRevision,
      remoteTaskId,
      taskRole: task.meta.taskRole ?? taskManifest.taskRole,
      parentRemoteTaskId:
        task.meta.parentRemoteTaskId ?? taskManifest.parentRemoteTaskId ?? null,
    });
  }
  recordSubmission(
    artifactManifest,
    options.submissionKind,
    bundleHash,
    submission,
  );
  for (const artifact of uploaded) {
    const remote = submission.artifacts?.find(
      (item) => item.path === artifact.path,
    );
    upsertManifestArtifact(artifactManifest, {
      path: artifact.path,
      type: artifact.type,
      lastSubmittedSha256: artifact.sha256,
      size: artifact.size,
      storage: "minio",
      objectRef: remote?.objectRef ?? artifact.objectRef,
      uploadSessionId: artifact.uploadSessionId,
      ...(remote?.remoteArtifactId
        ? { remoteArtifactId: remote.remoteArtifactId }
        : {}),
      ...(remote?.remoteRevision !== undefined
        ? { remoteRevision: remote.remoteRevision }
        : {}),
    });
  }
  if (options.submissionKind === "spec") {
    saveProjectSpecManifest(cwd, artifactManifest);
  } else {
    saveHubManifest(task.taskDir, taskManifest);
  }

  return {
    status: "submitted",
    message: `${options.submissionKind} submitted (${changed.length} artifact(s)).`,
  };
}

async function createUploadSession(options: {
  client: ReturnType<typeof createHubApiClient>;
  configProjectId: string;
  remoteTaskId: string;
  developerId: string;
  localTaskId: string;
  localTaskPath: string;
  artifactScope: "current_task" | "project_spec";
  submissionKind: "plan" | "spec" | "completion";
  artifactBundleHash: string;
  artifacts: readonly HubArtifact[];
}): Promise<UploadSessionResponse> {
  return options.client.requestJson<UploadSessionResponse>(
    "POST",
    `/projects/${encodeURIComponent(options.configProjectId)}/artifact-upload-sessions`,
    {
      developerId: options.developerId,
      remoteTaskId: options.remoteTaskId,
      localTaskId: options.localTaskId,
      localTaskPath: options.localTaskPath,
      artifactScope: options.artifactScope,
      submissionKind: options.submissionKind,
      artifactBundleHash: options.artifactBundleHash,
      artifacts: options.artifacts.map((artifact) => ({
        path: artifact.path,
        type: artifact.type,
        sha256: artifact.sha256,
        size: artifact.size,
        contentType: artifact.contentType,
      })),
    },
    [
      "hub:prepare-upload",
      options.remoteTaskId,
      options.artifactBundleHash,
    ].join(":"),
  );
}

async function uploadAllArtifacts(
  artifacts: readonly HubArtifact[],
  uploadSession: UploadSessionResponse,
  fetchImpl: FetchLike,
): Promise<UploadedArtifact[]> {
  const uploaded: UploadedArtifact[] = [];
  for (const artifact of artifacts) {
    const upload = uploadSession.uploads.find(
      (candidate) => candidate.path === artifact.path,
    );
    if (!upload) {
      throw new Error(`Hub upload session did not return URL for ${artifact.path}`);
    }
    uploaded.push(
      await uploadArtifactToMinio(
        artifact,
        upload,
        uploadSession.uploadSession.id,
        fetchImpl,
      ),
    );
  }
  return uploaded;
}

async function submitUploadedArtifacts(options: {
  client: ReturnType<typeof createHubApiClient>;
  projectId: string;
  remoteTaskId: string;
  developerId: string;
  requirementId?: string;
  requirementRevision?: number;
  localTaskId: string;
  localTaskPath: string;
  artifactScope: "current_task" | "project_spec";
  submissionKind: "plan" | "spec" | "completion";
  bundleHash: string;
  uploadSessionId: string;
  artifacts: readonly UploadedArtifact[];
  manifest: HubManifest;
  taskSummary: { status?: string; commit?: string; prUrl?: string };
}): Promise<SubmissionResponse> {
  const path = submissionApiPath(
    options.projectId,
    options.remoteTaskId,
    options.submissionKind,
  );
  const idempotencyKey = submissionIdempotencyKey(
    options.remoteTaskId,
    options.submissionKind,
    options.bundleHash,
    options.manifest,
  );
  return options.client.requestJson<SubmissionResponse>(
    "POST",
    path,
    submissionPayload(options),
    idempotencyKey,
  );
}

function submissionPayload(options: {
  developerId: string;
  requirementId?: string;
  requirementRevision?: number;
  localTaskId: string;
  localTaskPath: string;
  artifactScope: "current_task" | "project_spec";
  submissionKind: "plan" | "spec" | "completion";
  bundleHash: string;
  uploadSessionId: string;
  artifacts: readonly UploadedArtifact[];
  manifest: HubManifest;
  taskSummary: { status?: string; commit?: string; prUrl?: string };
}): Record<string, unknown> {
  const common = {
    developerId: options.developerId,
    requirementId: options.requirementId,
    localTaskId: options.localTaskId,
    localTaskPath: options.localTaskPath,
    artifactScope: options.artifactScope,
    uploadSessionId: options.uploadSessionId,
    artifacts: options.artifacts.map((artifact) => ({
      path: artifact.path,
      type: artifact.type,
      sha256: artifact.sha256,
      size: artifact.size,
      contentType: artifact.contentType,
      storage: artifact.storage,
      objectRef: artifact.objectRef,
      uploadSessionId: artifact.uploadSessionId,
    })),
  };

  if (options.submissionKind === "plan") {
    const planRevision = (options.manifest.planRevision ?? 0) + 1;
    return {
      ...common,
      requirementRevision: options.requirementRevision,
      planRevision,
      artifactBundleHash: options.bundleHash,
    };
  }

  if (options.submissionKind === "spec") {
    return {
      ...common,
      specBundleHash: options.bundleHash,
    };
  }

  return {
    ...common,
    includedChildTaskIds: [],
    completionBundleHash: options.bundleHash,
    summary: options.taskSummary,
  };
}

function submissionApiPath(
  projectId: string,
  remoteTaskId: string,
  kind: "plan" | "spec" | "completion",
): string {
  const suffix =
    kind === "plan"
      ? "plan-submissions"
      : kind === "spec"
        ? "spec-submissions"
        : "completion-submissions";
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/${suffix}`;
}

function submissionIdempotencyKey(
  remoteTaskId: string,
  kind: "plan" | "spec" | "completion",
  bundleHash: string,
  manifest: HubManifest,
): string {
  if (kind === "plan") {
    return [
      "hub:submit-plan",
      remoteTaskId,
      String((manifest.planRevision ?? 0) + 1),
      bundleHash,
    ].join(":");
  }
  return [`hub:submit-${kind}`, remoteTaskId, bundleHash].join(":");
}

function recordSubmission(
  manifest: HubManifest,
  kind: "plan" | "spec" | "completion",
  bundleHash: string,
  submission: SubmissionResponse,
): void {
  if (kind === "plan") {
    manifest.planRevision = (manifest.planRevision ?? 0) + 1;
    manifest.lastPlanBundleHash = bundleHash;
    if (submission.submission?.id) {
      manifest.lastPlanSubmissionId = submission.submission.id;
    }
    return;
  }
  if (kind === "spec") {
    manifest.lastSpecBundleHash = bundleHash;
    return;
  }
  manifest.lastCompletionBundleHash = bundleHash;
}

function currentHashes(
  manifest: HubManifest,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(manifest.artifacts).map(([key, artifact]) => [
      key,
      artifact.lastSubmittedSha256,
    ]),
  );
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStructuredSubtasks(taskDir: string): HubStructuredSubtask[] {
  const filePath = path.join(taskDir, "subtasks.json");
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  const subtasks = extractSubtasks(parsed);
  return subtasks.map(normalizeSubtask);
}

function extractSubtasks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") {
    throw new Error("subtasks.json must be an object with a subtasks array.");
  }
  const subtasks = (value as Record<string, unknown>).subtasks;
  if (!Array.isArray(subtasks)) {
    throw new Error("subtasks.json must contain a subtasks array.");
  }
  return subtasks;
}

function normalizeSubtask(value: unknown): HubStructuredSubtask {
  if (!value || typeof value !== "object") {
    throw new Error("Each structured subtask must be an object.");
  }
  const record = value as Record<string, unknown>;
  const subtask = {
    priority: requiredString(record.priority, "priority"),
    name: requiredString(record.name, "name"),
    description: requiredString(record.description, "description"),
  };
  return subtask;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Each structured subtask must include a non-empty ${field}.`);
  }
  return value.trim();
}
