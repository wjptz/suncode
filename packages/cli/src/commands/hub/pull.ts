import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { loadHubManifest } from "./manifest.js";
import { readHubTask } from "./task.js";
import type { FetchLike } from "./types.js";

export interface PullOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  taskJsonPath?: string;
  cursor?: string;
}

export async function pullRequirements(
  options: PullOptions = {},
): Promise<unknown> {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { skipped: true, reason: config.reason };
  }
  const client = createHubApiClient(config, options.fetch);
  const query = new URLSearchParams({
    developerId: config.developerId,
    status: "ready,in_review,changes_requested",
  });
  return client.requestJson(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/requirements?${query.toString()}`,
  );
}

export async function pullReview(options: PullOptions): Promise<unknown> {
  const { config, remoteTaskId, client } = resolveTaskRequest(options);
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  return client.requestJson(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/tasks/${encodeURIComponent(remoteTaskId)}/reviews${query.size ? `?${query.toString()}` : ""}`,
  );
}

export async function syncRequirement(options: PullOptions): Promise<unknown> {
  const { config, task, manifest, client } = resolveTaskRequest(options);
  const requirementId = task.meta.requirementId ?? manifest.requirementId;
  if (!requirementId) {
    throw new Error("Task has no Hub requirementId.");
  }
  const changesQuery = new URLSearchParams();
  if (options.cursor ?? manifest.requirementChangeCursor) {
    changesQuery.set(
      "cursor",
      options.cursor ?? manifest.requirementChangeCursor ?? "",
    );
  }
  const requirement = await client.requestJson(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/requirements/${encodeURIComponent(requirementId)}`,
  );
  const changes = await client.requestJson(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/requirements/${encodeURIComponent(requirementId)}/changes${changesQuery.size ? `?${changesQuery.toString()}` : ""}`,
  );
  return { requirement, changes };
}

function resolveTaskRequest(options: PullOptions): {
  config: ReturnType<typeof resolveHubConfig> & { enabled: true };
  task: ReturnType<typeof readHubTask>;
  manifest: ReturnType<typeof loadHubManifest>;
  remoteTaskId: string;
  client: ReturnType<typeof createHubApiClient>;
} {
  const cwd = options.cwd ?? process.cwd();
  if (!options.taskJsonPath) {
    throw new Error("taskJsonPath is required for this Hub command.");
  }
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    throw new Error(`Hub is disabled: ${config.reason}`);
  }
  const task = readHubTask(options.taskJsonPath, cwd);
  const manifest = loadHubManifest(task.taskDir);
  const remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (!remoteTaskId) {
    throw new Error("Task is not bound to Hub.");
  }
  return {
    config,
    task,
    manifest,
    remoteTaskId,
    client: createHubApiClient(config, options.fetch),
  };
}
