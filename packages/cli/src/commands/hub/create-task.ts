import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import {
  loadHubManifest,
  saveHubManifest,
  syncManifestTaskBinding,
} from "./manifest.js";
import { readHubTask, updateHubTaskMeta } from "./task.js";
import type { FetchLike, HubCommandResult } from "./types.js";

export interface HubCreateTaskOptions {
  cwd?: string;
  taskJsonPath: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

interface CreateTaskResponse {
  task: {
    id: string;
    projectId: string;
    requirementId?: string;
    localTaskId?: string;
    taskRole?: "single" | "parent" | "child";
    parentTaskId?: string | null;
    status?: string;
    createdAt?: string;
  };
}

export async function hubCreateTask(
  options: HubCreateTaskOptions,
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
  const existingRemoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (existingRemoteTaskId) {
    return {
      status: "skipped",
      message: `Task already bound to Hub task ${existingRemoteTaskId}`,
    };
  }

  const projectId = task.meta.projectId ?? config.projectId;
  if (projectId !== config.projectId) {
    throw new Error(
      `Task Hub projectId (${projectId}) does not match configured projectId (${config.projectId})`,
    );
  }

  const requirementId = task.meta.requirementId;
  if (!requirementId) {
    return {
      status: "skipped",
      message: "Task has no meta.hub.requirementId; ordinary local task skipped.",
    };
  }

  const taskRole = task.meta.taskRole ?? "single";
  if (taskRole === "child" && !task.meta.parentRemoteTaskId) {
    updateHubTaskMeta(task, { bindingStatus: "pending_parent" });
    return {
      status: "skipped",
      message: "Child task is waiting for parentRemoteTaskId.",
    };
  }

  const developerId = task.meta.developerId ?? config.developerId;
  const body = {
    developerId,
    requirementRevision: task.meta.requirementRevision,
    taskRole,
    parentRemoteTaskId: task.meta.parentRemoteTaskId ?? null,
    parentLocalTaskId: task.meta.parentLocalTaskId ?? null,
    localTaskId: task.localTaskId,
    localTaskName: stringField(task.task.name) ?? task.localTaskId,
    localTaskPath: task.localTaskPath,
    title: stringField(task.task.title) ?? task.localTaskId,
    source: "suncode",
  };

  const client = createHubApiClient(config, options.fetch);
  const idempotencyKey = createTaskIdempotencyKey({
    projectId: config.projectId,
    requirementId,
    localTaskId: task.localTaskId,
    taskRole,
    parentRemoteTaskId: task.meta.parentRemoteTaskId,
  });
  const response = await client.requestJson<CreateTaskResponse>(
    "POST",
    `/projects/${encodeURIComponent(config.projectId)}/requirements/${encodeURIComponent(requirementId)}/tasks`,
    body,
    idempotencyKey,
  );

  const remoteTaskId = response.task.id;
  syncManifestTaskBinding(manifest, {
    projectId: config.projectId,
    requirementId,
    requirementRevision: task.meta.requirementRevision,
    remoteTaskId,
    taskRole,
    parentRemoteTaskId: task.meta.parentRemoteTaskId ?? null,
  });
  saveHubManifest(task.taskDir, manifest);
  updateHubTaskMeta(task, {
    projectId: config.projectId,
    developerId,
    requirementId,
    remoteTaskId,
    taskRole,
    bindingStatus: "bound",
  });

  return {
    status: "created",
    message: `Hub task bound: ${remoteTaskId}`,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function createTaskIdempotencyKey(options: {
  projectId: string;
  requirementId: string;
  localTaskId: string;
  taskRole: "single" | "parent" | "child";
  parentRemoteTaskId?: string | null;
}): string {
  if (options.taskRole === "child" && options.parentRemoteTaskId) {
    return [
      "hub:create-task",
      options.projectId,
      options.requirementId,
      options.parentRemoteTaskId,
      options.localTaskId,
    ].join(":");
  }
  return [
    "hub:create-task",
    options.projectId,
    options.requirementId,
    options.localTaskId,
  ].join(":");
}
