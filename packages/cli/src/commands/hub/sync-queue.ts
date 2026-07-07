import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import type { HubCommandResult } from "./types.js";

export interface HubSyncQueueEntry {
  taskJsonPath: string;
  event: string;
  command: string;
  error: string;
  attempt: number;
  firstFailedAt: string;
  lastFailedAt: string;
  nextRetryAt: string;
}

export interface SyncPendingOptions {
  cwd?: string;
  now?: string;
  runner?: (entry: HubSyncQueueEntry) => SyncPendingRunResult;
}

export interface SyncPendingRunResult {
  status: number;
  error?: string;
}

export function pendingSyncCount(cwd: string): number {
  return readSyncQueue(cwd).length;
}

export function syncPending(
  options: SyncPendingOptions = {},
): HubCommandResult {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date().toISOString();
  const entries = readSyncQueue(cwd);
  if (entries.length === 0) {
    return { status: "skipped", message: "No pending Hub sync failures." };
  }

  const runner = options.runner ?? runQueuedCommand(cwd);
  const remaining: HubSyncQueueEntry[] = [];
  let retried = 0;
  let resolved = 0;

  for (const entry of entries) {
    if (Date.parse(entry.nextRetryAt) > Date.parse(now)) {
      remaining.push(entry);
      continue;
    }
    retried += 1;
    const queuedEntry = normalizeLegacyHubCommand(entry);
    const result = runner(queuedEntry);
    if (result.status === 0) {
      resolved += 1;
      continue;
    }
    remaining.push({
      ...queuedEntry,
      attempt: queuedEntry.attempt + 1,
      error: result.error?.trim() ? result.error : `command exited ${result.status}`,
      lastFailedAt: now,
      nextRetryAt: now,
    });
  }

  writeSyncQueue(cwd, remaining);
  return {
    status: "updated",
    message: `sync-pending: retried ${retried}, resolved ${resolved}, remaining ${remaining.length}.`,
  };
}

export function readSyncQueue(cwd: string): HubSyncQueueEntry[] {
  const filePath = syncQueuePath(cwd);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [normalizeEntry(JSON.parse(line) as unknown)];
      } catch {
        return [];
      }
    });
}

function writeSyncQueue(cwd: string, entries: readonly HubSyncQueueEntry[]): void {
  const filePath = syncQueuePath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (entries.length === 0) {
    fs.writeFileSync(filePath, "", "utf-8");
    return;
  }
  fs.writeFileSync(
    filePath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf-8",
  );
}

function normalizeLegacyHubCommand(entry: HubSyncQueueEntry): HubSyncQueueEntry {
  const command = normalizeLegacyTaskJsonShellArg(entry.command);
  return command === entry.command ? entry : { ...entry, command };
}

function normalizeLegacyTaskJsonShellArg(command: string): string {
  if (!command.trimStart().startsWith("suncode hub ")) {
    return command;
  }
  return command.replace(
    /\s+--task-json\s+(?:"\$TASK_JSON_PATH"|'\$TASK_JSON_PATH'|\$TASK_JSON_PATH)(?=\s|$)/g,
    "",
  );
}

function runQueuedCommand(
  cwd: string,
): (entry: HubSyncQueueEntry) => SyncPendingRunResult {
  return (entry) => {
    const result = spawnSync(entry.command, {
      cwd,
      shell: true,
      encoding: "utf-8",
      env: {
        ...process.env,
        SUNCODE_HOOKS: "0",
        TASK_JSON_PATH: entry.taskJsonPath,
      },
    });
    return {
      status: result.status ?? 1,
      error: result.stderr || result.stdout || result.error?.message,
    };
  };
}

function syncQueuePath(cwd: string): string {
  return path.join(cwd, DIR_NAMES.WORKFLOW, ".runtime", "hub-sync-queue.jsonl");
}

function normalizeEntry(value: unknown): HubSyncQueueEntry {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Hub sync queue entry.");
  }
  const record = value as Record<string, unknown>;
  return {
    taskJsonPath: requiredString(record.taskJsonPath, "taskJsonPath"),
    event: requiredString(record.event, "event"),
    command: requiredString(record.command, "command"),
    error: stringValue(record.error) ?? "hook failed",
    attempt: numberValue(record.attempt) ?? 1,
    firstFailedAt: stringValue(record.firstFailedAt) ?? new Date().toISOString(),
    lastFailedAt: stringValue(record.lastFailedAt) ?? new Date().toISOString(),
    nextRetryAt: stringValue(record.nextRetryAt) ?? new Date().toISOString(),
  };
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(`Missing ${field}.`);
  return result;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
