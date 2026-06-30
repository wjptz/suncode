import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { DIR_NAMES, FILE_NAMES } from "../../constants/paths.js";
import { toPosix } from "../../utils/posix.js";
import type { HubTaskContext, HubTaskMeta } from "./types.js";

const ENV_SESSION_KEYS: readonly [platform: string, keys: readonly string[]][] = [
  ["claude", ["CLAUDE_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]],
  ["codex", ["CODEX_SESSION_ID", "CODEX_THREAD_ID"]],
  ["cursor", ["CURSOR_SESSION_ID"]],
  ["opencode", ["OPENCODE_SESSION_ID", "OPENCODE_SESSIONID", "OPENCODE_RUN_ID"]],
  ["gemini", ["GEMINI_SESSION_ID"]],
  ["droid", ["FACTORY_SESSION_ID", "DROID_SESSION_ID"]],
  ["qoder", ["QODER_SESSION_ID"]],
  ["codebuddy", ["CODEBUDDY_SESSION_ID"]],
  ["kiro", ["KIRO_SESSION_ID"]],
  ["copilot", ["COPILOT_SESSION_ID", "COPILOT_SESSIONID"]],
  ["pi", ["PI_SESSION_ID", "PI_SESSIONID"]],
  ["trae", ["TRAE_SESSION_ID"]],
];

const ENV_CONVERSATION_KEYS: readonly [
  platform: string,
  keys: readonly string[],
][] = [["cursor", ["CURSOR_CONVERSATION_ID", "CURSOR_CONVERSATIONID"]]];

const ENV_TRANSCRIPT_KEYS: readonly [platform: string, keys: readonly string[]][] = [
  ["claude", ["CLAUDE_TRANSCRIPT_PATH"]],
  ["codex", ["CODEX_TRANSCRIPT_PATH"]],
  ["cursor", ["CURSOR_TRANSCRIPT_PATH"]],
  ["gemini", ["GEMINI_TRANSCRIPT_PATH"]],
  ["droid", ["FACTORY_TRANSCRIPT_PATH", "DROID_TRANSCRIPT_PATH"]],
  ["qoder", ["QODER_TRANSCRIPT_PATH"]],
  ["codebuddy", ["CODEBUDDY_TRANSCRIPT_PATH"]],
];

export class HubTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubTaskError";
  }
}

export interface ResolveTaskJsonPathOptions {
  cwd: string;
  taskJsonPath?: string;
  task?: string;
  env?: Record<string, string | undefined>;
}

export function resolveTaskJsonPath(
  options: ResolveTaskJsonPathOptions,
): string {
  const env = options.env ?? process.env;
  const explicit = options.taskJsonPath ?? env.TASK_JSON_PATH;
  if (explicit) {
    return path.resolve(options.cwd, explicit);
  }

  if (options.task === "current") {
    return resolveCurrentTaskJsonPath(options.cwd, env);
  }

  if (!options.task) {
    throw new HubTaskError(
      "Task is required. Pass --task-json, set TASK_JSON_PATH, or pass --task current / --task <task-dir>.",
    );
  }

  const taskDir = resolveTaskDir(options.cwd, options.task);
  return path.join(taskDir, FILE_NAMES.TASK_JSON);
}

function resolveCurrentTaskJsonPath(
  cwd: string,
  env: Record<string, string | undefined>,
): string {
  const sessionsDir = path.join(
    cwd,
    DIR_NAMES.WORKFLOW,
    ".runtime",
    "sessions",
  );
  const contextKey = resolveContextKey(env);
  if (contextKey) {
    const current = readSessionCurrentTask(
      path.join(sessionsDir, `${contextKey}.json`),
    );
    if (current) {
      return path.join(resolveTaskDir(cwd, current), FILE_NAMES.TASK_JSON);
    }
  }

  const fallback = resolveSingleSessionCurrentTask(sessionsDir);
  if (fallback) {
    return path.join(resolveTaskDir(cwd, fallback), FILE_NAMES.TASK_JSON);
  }

  throw new HubTaskError(
    "No current session task found. Pass --task-json or --task <task-dir>.",
  );
}

function resolveSingleSessionCurrentTask(sessionsDir: string): string | undefined {
  if (!fs.existsSync(sessionsDir)) return undefined;
  const files = fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(sessionsDir, entry.name))
    .sort();
  if (files.length !== 1) return undefined;
  return readSessionCurrentTask(files[0]);
}

function readSessionCurrentTask(sessionPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const currentTask = (parsed as Record<string, unknown>).current_task;
    return typeof currentTask === "string" && currentTask.trim()
      ? currentTask
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveContextKey(
  env: Record<string, string | undefined>,
): string | undefined {
  const explicit = stringValue(env.SUNCODE_CONTEXT_ID);
  if (explicit) return sanitizeKey(explicit) || hashValue(explicit);
  return (
    firstEnvContextKey(env, ENV_SESSION_KEYS, "session") ??
    firstEnvContextKey(env, ENV_CONVERSATION_KEYS, "conversation") ??
    firstEnvContextKey(env, ENV_TRANSCRIPT_KEYS, "transcript")
  );
}

function firstEnvContextKey(
  env: Record<string, string | undefined>,
  groups: readonly [platform: string, keys: readonly string[]][],
  kind: "session" | "conversation" | "transcript",
): string | undefined {
  for (const [platform, keys] of groups) {
    for (const key of keys) {
      const value = stringValue(env[key]);
      if (value) return contextKey(platform, kind, value);
    }
  }
  return undefined;
}

function contextKey(
  platform: string,
  kind: "session" | "conversation" | "transcript",
  value: string,
): string {
  if (kind === "transcript") {
    return `${platform}_transcript_${hashValue(value)}`;
  }
  const sanitized = sanitizeKey(value);
  return sanitized ? `${platform}_${sanitized}` : `${platform}_${hashValue(value)}`;
}

function sanitizeKey(raw: string): string {
  return raw
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "_")
    .replaceAll(/^[._-]+|[._-]+$/g, "")
    .slice(0, 160);
}

function hashValue(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, 24);
}

export function readHubTask(taskJsonPath: string, cwd: string): HubTaskContext {
  const resolved = path.resolve(cwd, taskJsonPath);
  if (!fs.existsSync(resolved)) {
    throw new HubTaskError(`task.json not found: ${resolved}`);
  }

  const task = JSON.parse(fs.readFileSync(resolved, "utf-8")) as Record<
    string,
    unknown
  >;
  const taskDir = path.dirname(resolved);
  const localTaskId = path.basename(taskDir);
  const localTaskPath = relativeToCwd(cwd, taskDir);
  const meta = readHubMeta(task);

  return {
    taskJsonPath: resolved,
    taskDir,
    localTaskId,
    localTaskPath,
    task,
    meta,
  };
}

export function updateHubTaskMeta(
  context: HubTaskContext,
  patch: HubTaskMeta,
): void {
  const task = context.task;
  const currentMeta =
    task.meta && typeof task.meta === "object"
      ? (task.meta as Record<string, unknown>)
      : {};
  const hub =
    currentMeta.hub && typeof currentMeta.hub === "object"
      ? (currentMeta.hub as Record<string, unknown>)
      : {};

  currentMeta.hub = { ...hub, ...patch };
  task.meta = currentMeta;
  fs.writeFileSync(context.taskJsonPath, `${JSON.stringify(task, null, 2)}\n`);
  context.meta = readHubMeta(task);
}

export function resolveTaskDir(cwd: string, task: string): string {
  const direct = path.resolve(cwd, task);
  if (fs.existsSync(path.join(direct, FILE_NAMES.TASK_JSON))) {
    return direct;
  }

  const tasksRoot = path.join(cwd, DIR_NAMES.WORKFLOW, DIR_NAMES.TASKS);
  const byName = path.join(tasksRoot, task);
  if (fs.existsSync(path.join(byName, FILE_NAMES.TASK_JSON))) {
    return byName;
  }

  if (fs.existsSync(tasksRoot)) {
    const found = fs
      .readdirSync(tasksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== DIR_NAMES.ARCHIVE)
      .map((entry) => path.join(tasksRoot, entry.name))
      .find((candidate) => path.basename(candidate).endsWith(`-${task}`));
    if (found && fs.existsSync(path.join(found, FILE_NAMES.TASK_JSON))) {
      return found;
    }
  }

  throw new HubTaskError(`Task not found: ${task}`);
}

export function relativeToCwd(cwd: string, target: string): string {
  return toPosix(path.relative(cwd, target));
}

function readHubMeta(task: Record<string, unknown>): HubTaskMeta {
  const meta = task.meta;
  if (!meta || typeof meta !== "object") return {};
  const hub = (meta as Record<string, unknown>).hub;
  if (!hub || typeof hub !== "object") return {};
  const record = hub as Record<string, unknown>;
  return {
    projectId: stringValue(record.projectId),
    developerId: stringValue(record.developerId),
    requirementId: stringValue(record.requirementId),
    requirementRevision: numberValue(record.requirementRevision),
    taskRole: taskRoleValue(record.taskRole),
    parentLocalTaskId: nullableStringValue(record.parentLocalTaskId),
    parentRemoteTaskId: nullableStringValue(record.parentRemoteTaskId),
    remoteTaskId: stringValue(record.remoteTaskId),
    bindingStatus: bindingStatusValue(record.bindingStatus),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringValue(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function taskRoleValue(value: unknown): HubTaskMeta["taskRole"] | undefined {
  if (value === "single" || value === "parent" || value === "child") {
    return value;
  }
  return undefined;
}

function bindingStatusValue(
  value: unknown,
): HubTaskMeta["bindingStatus"] | undefined {
  if (
    value === "pending" ||
    value === "pending_parent" ||
    value === "bound" ||
    value === "failed"
  ) {
    return value;
  }
  return undefined;
}
