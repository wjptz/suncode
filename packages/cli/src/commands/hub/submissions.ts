import fs from "node:fs";
import path from "node:path";

import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import {
  collectCompletionArtifacts,
  collectPlanArtifacts,
  collectReviewArtifacts,
  collectSpecArtifacts,
  filterChangedArtifacts,
} from "./artifacts.js";
import { hashArtifactBundle, hashText } from "./hash.js";
import { collectGitCommitRecords } from "./git.js";
import {
  loadHubManifest,
  loadProjectSpecManifest,
  saveProjectSpecManifest,
  saveHubManifest,
  syncManifestTaskBinding,
  upsertManifestArtifact,
} from "./manifest.js";
import { uploadArtifactToMinio, type UploadTarget } from "./minio.js";
import {
  collectCommittedReviewSnapshot,
  collectReviewCodeSnapshot,
} from "./review-state.js";
import { readHubTask } from "./task.js";
import type {
  FetchLike,
  HubArtifact,
  HubCommandResult,
  HubGitCommitRecord,
  HubManifest,
  HubReviewStatus,
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

export interface HubReviewSubmissionSummary {
  round: number;
  provider: string;
  status: HubReviewStatus;
  diffHash: string;
  headCommit?: string;
  summary: string;
  mustFixCount: number;
  advisoryCount: number;
}

export interface SubmitReviewOptions extends SubmitArtifactsOptions {
  round: number;
  review: HubReviewSubmissionSummary;
}

export interface HubStructuredSubtask {
  priority: string;
  name: string;
  description: string;
}

type SubmissionKind = "plan" | "spec" | "completion" | "review";
type ArtifactScope = "current_task" | "project_spec";

interface CompletionCommitSummary {
  commits: HubGitCommitRecord[];
  hash?: string;
}

interface TaskSummary {
  status?: string;
  commit?: string;
  prUrl?: string;
  commits?: HubGitCommitRecord[];
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

export async function submitReviewArtifacts(
  options: SubmitReviewOptions,
): Promise<HubCommandResult> {
  return submitArtifacts({
    ...options,
    submissionKind: "review",
    collect: (cwd, taskJsonPath) =>
      collectReviewArtifacts({ cwd, taskJsonPath, round: options.round }),
    reviewSummary: options.review,
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
    submissionKind: SubmissionKind;
    collect: (cwd: string, taskJsonPath: string) => HubArtifact[];
    reviewSummary?: HubReviewSubmissionSummary;
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

  if (
    options.submissionKind === "completion" &&
    config.review.required &&
    task.meta.taskType !== "quick"
  ) {
    assertCompletionReviewGate(cwd, taskManifest);
  }

  const artifacts = options.collect(cwd, task.taskJsonPath);
  if (artifacts.length === 0) {
    return { status: "skipped", message: "No artifacts found." };
  }

  const completionCommits =
    options.submissionKind === "completion"
      ? collectCompletionCommitSummary(cwd, taskManifest.gitBaseCommit)
      : { commits: [] };
  const commitsChanged =
    options.submissionKind === "completion" &&
    completionCommits.hash !== undefined &&
    completionCommits.hash !== taskManifest.lastSubmittedCommitsHash;

  let changed = options.force
    ? artifacts
    : filterChangedArtifacts(artifacts, currentHashes(artifactManifest));
  if (changed.length === 0 && commitsChanged) {
    changed = artifacts;
  }
  if (changed.length === 0) {
    return { status: "skipped", message: "No changed artifacts." };
  }

  const bundleHash = submissionBundleHash(
    options.submissionKind,
    changed,
    completionCommits.hash,
  );
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
    { apiBaseUrl: config.apiBaseUrl, token: config.token },
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
    taskSummary: buildTaskSummary(task.task, completionCommits.commits),
    reviewSummary: options.reviewSummary,
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
    options.reviewSummary,
  );
  if (
    options.submissionKind === "completion" &&
    completionCommits.hash !== undefined
  ) {
    taskManifest.lastSubmittedCommitsHash = completionCommits.hash;
  }
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
  artifactScope: ArtifactScope;
  submissionKind: SubmissionKind;
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
  hubAuth: { apiBaseUrl: string; token?: string },
): Promise<UploadedArtifact[]> {
  const uploaded: UploadedArtifact[] = [];
  for (const artifact of artifacts) {
    const upload = uploadSession.uploads.find(
      (candidate) => candidate.path === artifact.path,
    );
    if (!upload) {
      throw new Error(
        `Hub upload session did not return URL for ${artifact.path}`,
      );
    }
    uploaded.push(
      await uploadArtifactToMinio(
        artifact,
        upload,
        uploadSession.uploadSession.id,
        fetchImpl,
        hubAuth,
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
  artifactScope: ArtifactScope;
  submissionKind: SubmissionKind;
  bundleHash: string;
  uploadSessionId: string;
  artifacts: readonly UploadedArtifact[];
  manifest: HubManifest;
  taskSummary: TaskSummary;
  reviewSummary?: HubReviewSubmissionSummary;
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
    options.reviewSummary,
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
  submissionKind: SubmissionKind;
  bundleHash: string;
  uploadSessionId: string;
  artifacts: readonly UploadedArtifact[];
  manifest: HubManifest;
  taskSummary: TaskSummary;
  reviewSummary?: HubReviewSubmissionSummary;
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

  if (options.submissionKind === "review") {
    if (!options.reviewSummary) {
      throw new Error("Review submission requires a review summary.");
    }
    return {
      ...common,
      reviewBundleHash: options.bundleHash,
      review: options.reviewSummary,
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
  kind: SubmissionKind,
): string {
  const suffix =
    kind === "plan"
      ? "plan-submissions"
      : kind === "spec"
        ? "spec-submissions"
        : kind === "review"
          ? "review-submissions"
          : "completion-submissions";
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/${suffix}`;
}

function submissionIdempotencyKey(
  remoteTaskId: string,
  kind: SubmissionKind,
  bundleHash: string,
  manifest: HubManifest,
  reviewSummary?: HubReviewSubmissionSummary,
): string {
  if (kind === "plan") {
    return [
      "hub:submit-plan",
      remoteTaskId,
      String((manifest.planRevision ?? 0) + 1),
      bundleHash,
    ].join(":");
  }
  if (kind === "review") {
    if (!reviewSummary) {
      throw new Error("Review submission requires a review summary.");
    }
    return [
      "hub:submit-review",
      remoteTaskId,
      String(reviewSummary.round),
      bundleHash,
    ].join(":");
  }
  return [`hub:submit-${kind}`, remoteTaskId, bundleHash].join(":");
}

function recordSubmission(
  manifest: HubManifest,
  kind: SubmissionKind,
  bundleHash: string,
  submission: SubmissionResponse,
  reviewSummary?: HubReviewSubmissionSummary,
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
  if (kind === "review") {
    if (!reviewSummary) {
      throw new Error("Review submission requires a review summary.");
    }
    manifest.lastReviewBundleHash = bundleHash;
    manifest.lastReviewRound = reviewSummary.round;
    manifest.lastReviewStatus = reviewSummary.status;
    if (submission.submission?.id) {
      manifest.lastReviewSubmissionId = submission.submission.id;
    }
    if (reviewSummary.status === "approved") {
      manifest.approvedReviewDiffHash = reviewSummary.diffHash;
      if (reviewSummary.headCommit) {
        manifest.approvedReviewHeadCommit = reviewSummary.headCommit;
      }
    }
    return;
  }
  manifest.lastCompletionBundleHash = bundleHash;
}

function assertCompletionReviewGate(cwd: string, manifest: HubManifest): void {
  if (manifest.lastReviewStatus !== "approved") {
    throw new Error(
      "An approved Hub review is required before submit-completion. Run `suncode hub review` until it is approved.",
    );
  }
  if (!manifest.approvedReviewDiffHash) {
    throw new Error(
      "The latest approved Hub review is missing its diff hash. Run `suncode hub review` again.",
    );
  }

  const current = collectReviewCodeSnapshot(cwd);
  if (reviewGateMatchesCurrentSnapshot(manifest, current)) {
    return;
  }

  if (manifest.approvedReviewHeadCommit) {
    const committed = collectCommittedReviewSnapshot(
      cwd,
      manifest.approvedReviewHeadCommit,
    );
    if (manifest.approvedReviewDiffHash === committed.diffHash) {
      return;
    }
  }

  if (current.diff.length === 0 && manifest.approvedReviewHeadCommit) {
    throw new Error(
      "The latest approved Hub review does not match the committed changes. Run `suncode hub review` again before committing or resubmit a review for the current code.",
    );
  }

  throw new Error(
    "The latest approved Hub review no longer matches the current diff. Run `suncode hub review` again.",
  );
}

function reviewGateMatchesCurrentSnapshot(
  manifest: HubManifest,
  current: ReturnType<typeof collectReviewCodeSnapshot>,
): boolean {
  if (manifest.approvedReviewDiffHash !== current.diffHash) {
    return false;
  }
  if (
    manifest.approvedReviewHeadCommit &&
    current.headCommit &&
    manifest.approvedReviewHeadCommit !== current.headCommit
  ) {
    throw new Error(
      "The latest approved Hub review no longer matches the current commit. Run `suncode hub review` again.",
    );
  }
  return true;
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

function collectCompletionCommitSummary(
  cwd: string,
  baseCommit: string | undefined,
): CompletionCommitSummary {
  const commits = collectGitCommitRecords(cwd, baseCommit);
  return {
    commits,
    ...(commits.length > 0
      ? { hash: hashText(JSON.stringify({ version: 1, commits })) }
      : {}),
  };
}

function submissionBundleHash(
  kind: SubmissionKind,
  artifacts: readonly HubArtifact[],
  commitsHash: string | undefined,
): string {
  const artifactBundleHash = hashArtifactBundle(artifacts);
  if (kind !== "completion" || !commitsHash) return artifactBundleHash;
  return hashText(
    JSON.stringify({
      version: 1,
      artifactBundleHash,
      commitsHash,
    }),
  );
}

function buildTaskSummary(
  task: Record<string, unknown>,
  commits: readonly HubGitCommitRecord[],
): TaskSummary {
  const latestCommit = commits.at(-1)?.sha ?? stringField(task.commit);
  return {
    status: stringField(task.status),
    ...(latestCommit ? { commit: latestCommit } : {}),
    prUrl: stringField(task.pr_url),
    ...(commits.length > 0 ? { commits: [...commits] } : {}),
  };
}

function readStructuredSubtasks(taskDir: string): HubStructuredSubtask[] {
  const filePath = path.join(taskDir, "subtasks.json");
  if (fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    const subtasks = extractSubtasks(parsed);
    return subtasks.map(normalizeSubtask);
  }
  const executionPath = path.join(taskDir, "execution.json");
  if (fs.existsSync(executionPath)) {
    return readExecutionSubtasks(executionPath);
  }
  return readGeneratedSubtasks(taskDir);
}

function skipJsonWhitespace(source: string, index: number): number {
  while (index < source.length && /[\t\n\r ]/.test(source[index])) index += 1;
  return index;
}

function scanJsonStringEnd(source: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  return -1;
}

function scanTopLevelValueEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      if (depth === 0) return index;
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return index;
    }
  }
  return -1;
}

function hasExactTopLevelIntegerField(
  source: string,
  field: string,
  expected: number,
): boolean {
  let index = skipJsonWhitespace(source, 0);
  if (source[index] !== "{") return false;
  index += 1;
  let matches = 0;
  while (index < source.length) {
    index = skipJsonWhitespace(source, index);
    if (source[index] === "}") {
      index = skipJsonWhitespace(source, index + 1);
      return index === source.length && matches === 1;
    }
    if (source[index] !== '"') return false;
    const keyStart = index;
    const keyEnd = scanJsonStringEnd(source, keyStart);
    if (keyEnd < 0) return false;
    const key = JSON.parse(source.slice(keyStart, keyEnd)) as unknown;
    index = skipJsonWhitespace(source, keyEnd);
    if (source[index] !== ":") return false;
    const valueStart = skipJsonWhitespace(source, index + 1);
    const valueEnd = scanTopLevelValueEnd(source, valueStart);
    if (valueEnd < 0) return false;
    if (key === field) {
      matches += 1;
      if (source.slice(valueStart, valueEnd).trim() !== String(expected)) {
        return false;
      }
    }
    index = skipJsonWhitespace(source, valueEnd);
    if (source[index] === ",") {
      index += 1;
      continue;
    }
    if (source[index] === "}") continue;
    return false;
  }
  return false;
}

function readExecutionSubtasks(filePath: string): HubStructuredSubtask[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("execution.json must be an object.");
  }
  const plan = parsed as Record<string, unknown>;
  if (
    plan.version !== 1 ||
    !hasExactTopLevelIntegerField(source, "version", 1)
  ) {
    throw new Error("execution.json version must be the exact integer 1.");
  }
  const task = requiredExecutionString(plan.task, "task");
  const expectedTask = path.basename(path.dirname(filePath));
  if (task !== expectedTask) {
    throw new Error(
      `execution.json task must match task directory '${expectedTask}'.`,
    );
  }
  if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    throw new Error("execution.json must contain a non-empty nodes array.");
  }

  const nodes = plan.nodes.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`execution.json nodes[${index}] must be an object.`);
    }
    const record = value as Record<string, unknown>;
    const id = requiredExecutionString(record.id, `nodes[${index}].id`);
    const dependsOn = record.dependsOn;
    if (
      !Array.isArray(dependsOn) ||
      dependsOn.some(
        (dependency) => typeof dependency !== "string" || !dependency.trim(),
      )
    ) {
      throw new Error(
        `execution.json nodes[${index}].dependsOn must be an array of non-empty strings.`,
      );
    }
    return {
      id,
      dependsOn: dependsOn.map((dependency) => String(dependency).trim()),
      subtask: normalizeSubtask(record),
      order: index,
    };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (nodeMap.size !== nodes.length) {
    throw new Error("execution.json contains duplicate node ids.");
  }
  const followers = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(
    nodes.map((node) => [node.id, node.dependsOn.length]),
  );
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeMap.has(dependency)) {
        throw new Error(
          `execution.json node ${node.id} depends on unknown node ${dependency}.`,
        );
      }
      followers.get(dependency)?.push(node.id);
    }
  }

  const ready = nodes.filter((node) => indegree.get(node.id) === 0);
  const ordered: typeof nodes = [];
  while (ready.length > 0) {
    ready.sort((left, right) => left.order - right.order);
    const current = ready.shift();
    if (!current) break;
    ordered.push(current);
    for (const followerId of followers.get(current.id) ?? []) {
      const remaining = (indegree.get(followerId) ?? 0) - 1;
      indegree.set(followerId, remaining);
      if (remaining === 0) {
        const follower = nodeMap.get(followerId);
        if (follower) ready.push(follower);
      }
    }
  }
  if (ordered.length !== nodes.length) {
    throw new Error("execution.json dependency graph contains a cycle.");
  }
  return ordered.map((node) => node.subtask);
}

function requiredExecutionString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`execution.json ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readGeneratedSubtasks(taskDir: string): HubStructuredSubtask[] {
  const filePath = path.join(taskDir, "implement.md");
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map(parseImplementChecklistLine)
    .filter((item): item is HubStructuredSubtask => item !== undefined);
}

function parseImplementChecklistLine(
  line: string,
): HubStructuredSubtask | undefined {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+(.+?)\s*$/);
  if (!match) return undefined;

  let text = stripInlineMarkdown(match[1].trim());
  if (!text) return undefined;

  let priority = "P2";
  const priorityMatch = text.match(/^\[?(P[0-3])\]?(?:\s*[:：-])?\s+/i);
  if (priorityMatch) {
    priority = priorityMatch[1].toUpperCase();
    text = text.slice(priorityMatch[0].length).trim();
  }
  if (!text) return undefined;

  const separatorIndex = firstSeparatorIndex(text);
  const name =
    separatorIndex > 0 ? text.slice(0, separatorIndex).trim() : text.trim();
  const description =
    separatorIndex > 0 ? text.slice(separatorIndex + 1).trim() : text.trim();

  if (!name) return undefined;
  return {
    priority,
    name,
    description: description || name,
  };
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function firstSeparatorIndex(text: string): number {
  const ascii = text.indexOf(":");
  const chinese = text.indexOf("：");
  if (ascii === -1) return chinese;
  if (chinese === -1) return ascii;
  return Math.min(ascii, chinese);
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
    throw new Error(
      `Each structured subtask must include a non-empty ${field}.`,
    );
  }
  return value.trim();
}
