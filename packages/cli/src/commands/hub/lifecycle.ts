import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { hashArtifactBundle } from "./hash.js";
import { loadHubManifest } from "./manifest.js";
import { readHubTask } from "./task.js";
import type { FetchLike, HubCommandResult } from "./types.js";

export interface MarkStartedOptions {
  cwd?: string;
  taskJsonPath: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  status?: string;
}

export interface PreflightStartOptions extends MarkStartedOptions {
  confirmUnapprovedReview?: boolean;
}

export async function markStarted(
  options: MarkStartedOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }

  const task = readHubTask(options.taskJsonPath, cwd);
  const manifest = loadHubManifest(task.taskDir);
  const remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (!remoteTaskId) {
    return { status: "skipped", message: "Task is not bound to Hub." };
  }

  const client = createHubApiClient(config, options.fetch);
  const status = options.status ?? "in_progress";
  await client.requestJson(
    "PATCH",
    `/projects/${encodeURIComponent(config.projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/status`,
    {
      developerId: task.meta.developerId ?? config.developerId,
      status,
      localStatus: stringField(task.task.status) ?? status,
      localTaskPath: task.localTaskPath,
      updatedAt: new Date().toISOString(),
    },
    [
      "hub:mark-started",
      remoteTaskId,
      stringField(task.task.status) ?? status,
    ].join(":"),
  );

  return { status: "updated", message: `Hub task marked ${status}.` };
}

export async function preflightStart(
  options: PreflightStartOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }

  const task = readHubTask(options.taskJsonPath, cwd);
  const manifest = loadHubManifest(task.taskDir);
  const remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (!remoteTaskId) {
    return { status: "skipped", message: "Task is not bound to Hub." };
  }

  const client = createHubApiClient(config, options.fetch);
  const artifactBundleHash = manifest.lastPlanBundleHash ?? hashArtifactBundle([]);
  await client.requestJson(
    "POST",
    `/projects/${encodeURIComponent(config.projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/preflight-start`,
    {
      developerId: task.meta.developerId ?? config.developerId,
      requirementId: task.meta.requirementId ?? manifest.requirementId,
      requirementRevision:
        task.meta.requirementRevision ?? manifest.requirementRevision,
      planSubmissionId: manifest.lastPlanSubmissionId,
      artifactBundleHash,
      startReviewPolicy: config.startReviewPolicy,
      confirmUnapprovedReview: options.confirmUnapprovedReview === true,
      ...(options.confirmUnapprovedReview
        ? {
            confirmationSource: "user",
            confirmationSummary:
              "User explicitly confirmed starting before review approval in the AI session.",
          }
        : {}),
    },
    [
      "hub:preflight-start",
      remoteTaskId,
      String(task.meta.requirementRevision ?? manifest.requirementRevision ?? 0),
      artifactBundleHash,
    ].join(":"),
  );

  return { status: "updated", message: "Hub preflight passed." };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
