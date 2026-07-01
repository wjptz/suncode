import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import { createHubApiClient } from "./client.js";
import { HubConfigError, resolveHubConfig } from "./config.js";
import { isHubSessionExpired, getHubSession } from "./auth.js";
import { resolveTaskJsonPath, readHubTask } from "./task.js";
import type { FetchLike, HubTaskContext } from "./types.js";

export type HubOnOff = "on" | "off";
export type HubConfigState = "off" | "ok" | "invalid";
export type HubLoginState = "skipped" | "ok" | "missing" | "expired";
export type HubServiceState = "skipped" | "ok" | "unavailable";
export type HubWorkState = "skipped" | "none" | "available";
export type HubCurrentTaskState =
  | "none"
  | "hub-bound"
  | "hub-pending"
  | "local-only"
  | "unknown";

export interface HubStateSummary {
  hub: HubOnOff;
  config: HubConfigState;
  login: HubLoginState;
  service: HubServiceState;
  work: HubWorkState;
  currentTask: HubCurrentTaskState;
}

export interface HubStateResult {
  version: 1;
  refreshedAt: string;
  project?: {
    projectId?: string;
    apiBaseUrl?: string;
    apiBaseUrlSource?: "project" | "global";
  };
  summary: HubStateSummary;
  message: string;
  nextAction: string;
  service?: {
    name?: string;
    version?: string;
    status?: string;
  };
  work?: {
    availableCount: number;
    items: { id: string; title?: string; status?: string }[];
  };
  currentTask?: {
    state: HubCurrentTaskState;
    taskId?: string;
    reason?: string;
  };
}

export interface HubStateOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  now?: number;
}

export async function hubState(
  options: HubStateOptions = {},
): Promise<HubStateResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? Date.now();
  const currentTask = readCurrentTaskState(cwd, options.env);

  let config: ReturnType<typeof resolveHubConfig>;
  try {
    config = resolveHubConfig({
      cwd,
      env: options.env,
      homeDir: options.homeDir,
      requireAuth: false,
    });
  } catch (error) {
    const result = stateResult({
      summary: {
        hub: "on",
        config: "invalid",
        login: "skipped",
        service: "skipped",
        work: "skipped",
        currentTask: currentTask.state,
      },
      message:
        error instanceof Error ? sanitizeError(error.message) : "Hub config invalid.",
      nextAction: "先运行 `suncode hub init` 修复 Hub 配置。",
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  }

  if (!config.enabled) {
    const result = stateResult({
      summary: {
        hub: "off",
        config: "off",
        login: "skipped",
        service: "skipped",
        work: "skipped",
        currentTask: currentTask.state,
      },
      message: `hub off: ${config.reason}`,
      nextAction: "使用本地普通 Suncode 工作流，不要运行 Hub 专用命令。",
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  }

  const session = getHubSession(config.apiBaseUrl, { homeDir: options.homeDir });
  if (!session) {
    const result = stateResult({
      project: {
        projectId: config.projectId,
        apiBaseUrl: config.apiBaseUrl,
        apiBaseUrlSource: config.apiBaseUrlSource,
      },
      summary: {
        hub: "on",
        config: "ok",
        login: "missing",
        service: "skipped",
        work: "skipped",
        currentTask: currentTask.state,
      },
      message: `Hub configured for project ${config.projectId}, but login is missing.`,
      nextAction: "请用户运行 `suncode hub login` 后再使用 Hub 工作流。",
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  }

  if (isHubSessionExpired(session, now)) {
    const result = stateResult({
      project: {
        projectId: config.projectId,
        apiBaseUrl: config.apiBaseUrl,
        apiBaseUrlSource: config.apiBaseUrlSource,
      },
      summary: {
        hub: "on",
        config: "ok",
        login: "expired",
        service: "skipped",
        work: "skipped",
        currentTask: currentTask.state,
      },
      message: `Hub login for ${config.apiBaseUrl} is expired.`,
      nextAction: "请用户重新运行 `suncode hub login`。",
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  }

  try {
    const authedConfig = resolveHubConfig({
      cwd,
      env: options.env,
      homeDir: options.homeDir,
      requireAuth: true,
    });
    if (!authedConfig.enabled) {
      throw new HubConfigError(authedConfig.reason);
    }
    const client = createHubApiClient(authedConfig, options.fetch);
    const service = normalizeService(
      await client.requestJson<unknown>("GET", "/health"),
    );
    const work = normalizeWork(
      await client.requestJson<unknown>(
        "GET",
        `/projects/${encodeURIComponent(authedConfig.projectId)}/requirements?${new URLSearchParams(
          {
            developerId: authedConfig.developerId,
            status: "ready,in_review,changes_requested",
          },
        ).toString()}`,
      ),
    );
    const hasWork = work.availableCount > 0;
    const result = stateResult({
      project: {
        projectId: authedConfig.projectId,
        apiBaseUrl: authedConfig.apiBaseUrl,
        apiBaseUrlSource: authedConfig.apiBaseUrlSource,
      },
      summary: {
        hub: "on",
        config: "ok",
        login: "ok",
        service: "ok",
        work: hasWork ? "available" : "none",
        currentTask: currentTask.state,
      },
      message: hasWork
        ? `Hub 可用，有 ${work.availableCount} 个可接需求。`
        : "Hub 可用，当前没有可接需求。",
      nextAction: nextActionFor(currentTask.state, hasWork),
      service,
      work,
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  } catch (error) {
    const result = stateResult({
      project: {
        projectId: config.projectId,
        apiBaseUrl: config.apiBaseUrl,
        apiBaseUrlSource: config.apiBaseUrlSource,
      },
      summary: {
        hub: "on",
        config: "ok",
        login: "ok",
        service: "unavailable",
        work: "skipped",
        currentTask: currentTask.state,
      },
      message: `Hub service unavailable: ${sanitizeError(
        error instanceof Error ? error.message : String(error),
      )}`,
      nextAction: "当前 Hub 服务不可用，不要进入 Hub 专用流程。",
      currentTask,
    });
    writeHubStateCache(cwd, result);
    return result;
  }
}

export function printHubState(result: HubStateResult): void {
  console.log(result.message);
  console.log(`hub: ${result.summary.hub}`);
  console.log(`config: ${result.summary.config}`);
  console.log(`login: ${result.summary.login}`);
  console.log(`service: ${result.summary.service}`);
  console.log(`work: ${result.summary.work}`);
  console.log(`current task: ${result.summary.currentTask}`);
  console.log(`next: ${result.nextAction}`);
}

export function classifyHubTaskState(task: HubTaskContext): {
  state: HubCurrentTaskState;
  reason: string;
} {
  if (task.meta.remoteTaskId || task.meta.bindingStatus === "bound") {
    return {
      state: "hub-bound",
      reason: "task has meta.hub.remoteTaskId or bound bindingStatus",
    };
  }
  if (
    task.meta.requirementId ||
    task.meta.bindingStatus === "pending" ||
    task.meta.bindingStatus === "pending_parent" ||
    task.meta.bindingStatus === "failed"
  ) {
    return {
      state: "hub-pending",
      reason: "task has Hub requirement metadata but no remote task binding",
    };
  }
  return {
    state: "local-only",
    reason: "task.json has no meta.hub.requirementId or remoteTaskId",
  };
}

function readCurrentTaskState(
  cwd: string,
  env?: Record<string, string | undefined>,
): NonNullable<HubStateResult["currentTask"]> {
  try {
    const taskJsonPath = resolveTaskJsonPath({
      cwd,
      task: "current",
      env,
    });
    const task = readHubTask(taskJsonPath, cwd);
    const classification = classifyHubTaskState(task);
    return {
      state: classification.state,
      taskId: task.localTaskId,
      reason: classification.reason,
    };
  } catch {
    return { state: "none", reason: "no active session task" };
  }
}

function normalizeService(value: unknown): HubStateResult["service"] {
  if (!value || typeof value !== "object") return { status: "ok" };
  const record = value as Record<string, unknown>;
  return {
    status: stringField(record.status) ?? "ok",
    ...(stringField(record.name) ? { name: stringField(record.name) } : {}),
    ...(stringField(record.version)
      ? { version: stringField(record.version) }
      : {}),
  };
}

function normalizeWork(value: unknown): NonNullable<HubStateResult["work"]> {
  const rawItems = extractWorkItems(value);
  const items = rawItems.slice(0, 5).map((item) => {
    const record = item as Record<string, unknown>;
    return {
      id: stringField(record.id) ?? stringField(record.requirementId) ?? "unknown",
      ...(stringField(record.title) ? { title: stringField(record.title) } : {}),
      ...(stringField(record.status)
        ? { status: stringField(record.status) }
        : {}),
    };
  });
  return { availableCount: rawItems.length, items };
}

function extractWorkItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  for (const key of ["requirements", "items", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function stateResult(
  input: Omit<HubStateResult, "version" | "refreshedAt">,
): HubStateResult {
  return {
    version: 1,
    refreshedAt: new Date().toISOString(),
    ...input,
  };
}

function writeHubStateCache(cwd: string, result: HubStateResult): void {
  const runtimeDir = path.join(cwd, DIR_NAMES.WORKFLOW, ".runtime");
  if (!fs.existsSync(path.join(cwd, DIR_NAMES.WORKFLOW))) return;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "hub-state.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf-8",
  );
}

function nextActionFor(
  currentTask: HubCurrentTaskState,
  hasWork: boolean,
): string {
  if (currentTask === "local-only") {
    return "当前任务是普通本地任务，不要执行 Hub 任务提交命令；如要接 Hub 任务，先绑定 Hub 需求。";
  }
  if (hasWork) {
    return "询问用户是否接取 Hub 需求，或运行 `suncode hub pull` 查看待选需求。";
  }
  return "继续当前本地工作流；没有待选 Hub 需求。";
}

function sanitizeError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/token["':=\s]+[A-Za-z0-9._~+/=-]+/gi, "token=[redacted]");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
