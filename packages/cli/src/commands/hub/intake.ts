import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES, FILE_NAMES } from "../../constants/paths.js";
import { toPosix } from "../../utils/posix.js";
import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { hubCreateTask } from "./create-task.js";
import { loadHubManifest } from "./manifest.js";
import { pullHubSpecs, type HubSpecSyncResult } from "./specs.js";
import { readHubTask, setCurrentSessionTask, updateHubTaskMeta } from "./task.js";
import type {
  FetchLike,
  HubCommandResult,
  HubSourceTaskSummary,
  HubTaskMeta,
  HubTaskType,
} from "./types.js";

export interface HubIntakeOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  list?: boolean;
  auto?: boolean;
  requirementId?: string;
  slug?: string;
  taskJsonPath?: string;
  now?: Date;
}

interface HubRequirement {
  id: string;
  title: string;
  description?: string;
  revision?: number;
  status?: string;
  taskType: HubTaskType;
  rawTaskType?: string;
  sourceTask?: HubSourceTaskSummary;
}

export async function hubIntake(
  options: HubIntakeOptions = {},
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
  if (options.list && options.taskJsonPath) {
    throw new Error("hub intake --list cannot be combined with --task or --task-json.");
  }

  const client = createHubApiClient(config, options.fetch);
  const query = new URLSearchParams({
    developerId: config.developerId,
    status: "ready,in_review,changes_requested",
  });
  const pulled = await client.requestJson<unknown>(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/requirements?${query.toString()}`,
  );
  const requirements = normalizeRequirements(pulled);

  if (options.list) {
    return {
      status: "skipped",
      message: `requirements available: ${requirements.length}${formatRequirementList(requirements)}`,
    };
  }

  const selected = selectRequirement(requirements, options);
  if (!selected.requirement) {
    return { status: "skipped", message: selected.message };
  }

  const taskJsonPath = options.taskJsonPath
    ? prepareExistingLocalHubTask({
        cwd,
        projectId: config.projectId,
        developerId: config.developerId,
        requirement: selected.requirement,
        taskJsonPath: options.taskJsonPath,
      })
    : createLocalHubTask({
        cwd,
        projectId: config.projectId,
        developerId: config.developerId,
        requirement: selected.requirement,
        slug: options.slug,
        now: options.now ?? new Date(),
      });
  setCurrentSessionTask({
    cwd,
    taskDir: path.dirname(taskJsonPath),
    env: options.env,
  });
  const bindResult = await hubCreateTask({
    cwd,
    taskJsonPath,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
  });
  const specSummary = config.autoPullSpec
    ? await syncSpecsNonBlocking({
        cwd,
        env: options.env,
        homeDir: options.homeDir,
        fetch: options.fetch,
      })
    : "spec: auto-pull disabled; run suncode hub pull-spec when needed";

  return {
    status: bindResult.status,
    message: `intake: ${toPosix(path.relative(cwd, path.dirname(taskJsonPath)))}; ${bindResult.message ?? bindResult.status}; ${specSummary}`,
  };
}

async function syncSpecsNonBlocking(options: {
  cwd: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
}): Promise<string> {
  try {
    return formatSpecSyncSummary(await pullHubSpecs(options));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `spec sync FAILED (${reason}); retry: suncode hub pull-spec`;
  }
}

function formatSpecSyncSummary(result: HubSpecSyncResult): string {
  const parts: string[] = [];
  if (result.actions.added.length > 0) parts.push(`+${result.actions.added.length}`);
  if (result.actions.updated.length > 0) parts.push(`~${result.actions.updated.length}`);
  if (result.actions.deleted.length > 0) {
    const preserved = result.deletionCandidates.length > 0 ? "(preserved)" : "";
    parts.push(`-${result.actions.deleted.length}${preserved}`);
  }
  if (result.localOnly.length > 0) parts.push(`local-only ${result.localOnly.length}`);
  if (parts.length === 0) return "spec: up-to-date";
  return `spec: ${parts.join(" ")}`;
}

function selectRequirement(
  requirements: readonly HubRequirement[],
  options: HubIntakeOptions,
): { requirement?: HubRequirement; message: string } {
  if (options.requirementId) {
    const requirement = requirements.find((item) => item.id === options.requirementId);
    if (!requirement) {
      return {
        message: `requirement not found: ${options.requirementId}${formatRequirementList(requirements)}`,
      };
    }
    return { requirement, message: "selected" };
  }

  if (options.auto && requirements.length === 1) {
    return { requirement: requirements[0], message: "selected" };
  }

  if (requirements.length === 0) {
    return { message: "no requirements available." };
  }

  return {
    message: `ambiguous: ${requirements.length} requirements available. Pass --requirement <id>.${formatRequirementList(requirements)}`,
  };
}

function createLocalHubTask(options: {
  cwd: string;
  projectId: string;
  developerId: string;
  requirement: HubRequirement;
  slug?: string;
  now: Date;
}): string {
  const tasksDir = path.join(options.cwd, DIR_NAMES.WORKFLOW, DIR_NAMES.TASKS);
  fs.mkdirSync(tasksDir, { recursive: true });

  const slug = uniqueTaskSlug(
    tasksDir,
    datePrefix(options.now),
    hubRequirementSlug(options.requirement.id, options.slug),
  );
  const taskDir = path.join(tasksDir, `${datePrefix(options.now)}-${slug}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const titlePrefix = `HUB-REQ-${requirementIdWithoutReqPrefix(
    options.requirement.id,
  )}`;
  const title = `${titlePrefix} ${options.requirement.title}`.trim();
  const createdAt = options.now.toISOString().slice(0, 10);
  const taskJsonPath = path.join(taskDir, FILE_NAMES.TASK_JSON);
  fs.writeFileSync(
    taskJsonPath,
    `${JSON.stringify(
      {
        id: slug,
        name: title,
        title,
        description: options.requirement.description ?? "",
        status: "planning",
        dev_type: null,
        scope: null,
        package: null,
        priority: "P2",
        creator: options.developerId,
        assignee: options.developerId,
        createdAt,
        completedAt: null,
        branch: null,
        base_branch: "main",
        worktree_path: null,
        commit: null,
        pr_url: null,
        subtasks: [],
        children: [],
        parent: null,
        relatedFiles: [],
        notes: "",
        meta: {
          hub: {
            projectId: options.projectId,
            developerId: options.developerId,
            requirementId: options.requirement.id,
            requirementRevision: options.requirement.revision,
            taskType: options.requirement.taskType,
            ...(options.requirement.rawTaskType
              ? { rawTaskType: options.requirement.rawTaskType }
              : {}),
            ...(options.requirement.sourceTask
              ? { sourceTask: options.requirement.sourceTask }
              : {}),
            taskRole: "single",
            bindingStatus: "pending",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(taskDir, FILE_NAMES.PRD),
    defaultPrd(title, options.requirement),
    "utf-8",
  );
  if (options.requirement.taskType === "change") {
    const researchDir = path.join(taskDir, "research");
    fs.mkdirSync(researchDir, { recursive: true });
    fs.writeFileSync(
      path.join(researchDir, "source-task.md"),
      sourceTaskResearch(title, options.requirement),
      "utf-8",
    );
  }
  return taskJsonPath;
}

function prepareExistingLocalHubTask(options: {
  cwd: string;
  projectId: string;
  developerId: string;
  requirement: HubRequirement;
  taskJsonPath: string;
}): string {
  const task = readHubTask(options.taskJsonPath, options.cwd);
  const manifest = loadHubManifest(task.taskDir);
  const existingRemoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (existingRemoteTaskId) {
    return task.taskJsonPath;
  }

  if (task.meta.projectId && task.meta.projectId !== options.projectId) {
    throw new Error(
      `Existing task Hub projectId (${task.meta.projectId}) does not match configured projectId (${options.projectId}).`,
    );
  }
  if (
    task.meta.requirementId &&
    task.meta.requirementId !== options.requirement.id
  ) {
    throw new Error(
      `Existing task is already prepared for Hub requirement ${task.meta.requirementId}.`,
    );
  }

  updateHubTaskMeta(task, hubMetaFromRequirement(options, task.meta));
  return task.taskJsonPath;
}

function hubMetaFromRequirement(
  options: {
    projectId: string;
    developerId: string;
    requirement: HubRequirement;
  },
  current: HubTaskMeta,
): HubTaskMeta {
  return {
    projectId: options.projectId,
    developerId: options.developerId,
    requirementId: options.requirement.id,
    requirementRevision: options.requirement.revision,
    taskType: options.requirement.taskType,
    rawTaskType: options.requirement.rawTaskType,
    sourceTask: options.requirement.sourceTask,
    taskRole: current.taskRole ?? "single",
    parentLocalTaskId: current.parentLocalTaskId,
    parentRemoteTaskId: current.parentRemoteTaskId,
    bindingStatus: "pending",
  };
}

function normalizeRequirements(value: unknown): HubRequirement[] {
  const raw = extractRequirementItems(value);
  return raw.flatMap((item) => {
    const id = stringValue(item.id) ?? stringValue(item.requirementId);
    if (!id) return [];
    const taskType = normalizeTaskType(
      firstString(item, ["taskType", "kind", "type", "requirementType"]),
    );
    const sourceTask = normalizeSourceTask(item.sourceTask);
    return [
      {
        id,
        title: stringValue(item.title) ?? id,
        description: stringValue(item.description),
        revision:
          numberValue(item.revision) ?? numberValue(item.requirementRevision),
        status: stringValue(item.status),
        taskType: taskType.taskType,
        ...(taskType.rawTaskType ? { rawTaskType: taskType.rawTaskType } : {}),
        ...(sourceTask ? { sourceTask } : {}),
      },
    ];
  });
}

function extractRequirementItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["requirements", "items", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function hubRequirementSlug(requirementId: string, explicitSlug?: string): string {
  const prefix = `hub-req-${slugifyAscii(
    requirementIdWithoutReqPrefix(requirementId),
  )}`;
  const suffix = explicitSlug ? slugifyAscii(explicitSlug) : "";
  if (!suffix || suffix === prefix) return prefix;
  return suffix.startsWith(prefix) ? suffix : `${prefix}-${suffix}`;
}

function requirementIdWithoutReqPrefix(requirementId: string): string {
  const normalized = requirementId.trim();
  const withoutSeparatedPrefix = normalized.replace(/^req[-_\s:]+/i, "");
  if (withoutSeparatedPrefix !== normalized) return withoutSeparatedPrefix;
  return normalized.replace(/^req(?=\d)/i, "");
}

function uniqueTaskSlug(
  tasksDir: string,
  prefix: string,
  slug: string,
): string {
  let candidate = slug;
  let index = 2;
  while (fs.existsSync(path.join(tasksDir, `${prefix}-${candidate}`))) {
    candidate = `${slug}-${index}`;
    index += 1;
  }
  return candidate;
}

function datePrefix(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

function defaultPrd(title: string, requirement: HubRequirement): string {
  const rawTypeLine = requirement.rawTaskType
    ? `\n- Raw Type: ${requirement.rawTaskType}`
    : "";
  return `# ${title}

## Hub Requirement

- ID: ${requirement.id}
- Revision: ${requirement.revision ?? "-"}
- Status: ${requirement.status ?? "-"}
- Type: ${requirement.taskType}${rawTypeLine}

## 目标

${requirement.description?.trim() ? requirement.description : requirement.title}

${taskTypePrdSection(requirement)}
## 需求

- 待补充

## 验收标准

- [ ] 待补充
`;
}

function taskTypePrdSection(requirement: HubRequirement): string {
  if (requirement.taskType === "quick") {
    return `## 快速任务约束

- 运行 \`suncode hub plan-ready --task current\` 上传 plan artifacts；quick 分支会跳过计划审核和 Hub start preflight。
- 跳过 Hub code review 和 check-agent review。
- 保持最小确定性验证；若未执行检查，\`validation-summary.md\` 必须写明 \`未执行\` 及原因。
- 仍需生成并通过 \`suncode hub finish --task current\` 上传完成产物。

`;
  }
  if (requirement.taskType === "change") {
    return `## 需求变更约束

- 本次 Hub Requirement 是当前需求的唯一权威；\`sourceTask\` 只用于理解旧需求背景。
- 修改前先阅读 \`research/source-task.md\`，避免误把旧需求当作新验收标准。

## Source Task

${formatSourceTask(requirement.sourceTask)}

`;
  }
  return "";
}

function sourceTaskResearch(title: string, requirement: HubRequirement): string {
  return `# Source Task for ${title}

## Usage

- 当前需求：${requirement.id}
- 当前类型：${requirement.taskType}
- 旧任务仅作为历史背景；实现与验收以当前 Hub Requirement 为准。

## Source Task

${formatSourceTask(requirement.sourceTask)}
`;
}

function formatSourceTask(sourceTask: HubSourceTaskSummary | undefined): string {
  if (!sourceTask) return "- Hub 未提供 sourceTask 摘要。";
  const lines: string[] = [];
  if (sourceTask.id) lines.push(`- ID: ${sourceTask.id}`);
  if (sourceTask.remoteTaskId) {
    lines.push(`- Remote Task ID: ${sourceTask.remoteTaskId}`);
  }
  if (sourceTask.localTaskId) {
    lines.push(`- Local Task ID: ${sourceTask.localTaskId}`);
  }
  if (sourceTask.localTaskPath) {
    lines.push(`- Local Task Path: ${sourceTask.localTaskPath}`);
  }
  if (sourceTask.title) lines.push(`- Title: ${sourceTask.title}`);
  if (sourceTask.requirementId) {
    lines.push(`- Requirement ID: ${sourceTask.requirementId}`);
  }
  if (sourceTask.requirementRevision !== undefined) {
    lines.push(`- Requirement Revision: ${sourceTask.requirementRevision}`);
  }
  if (sourceTask.status) lines.push(`- Status: ${sourceTask.status}`);
  if (sourceTask.completedAt) {
    lines.push(`- Completed At: ${sourceTask.completedAt}`);
  }
  if (sourceTask.summary) lines.push(`- Summary: ${sourceTask.summary}`);
  return lines.length > 0 ? lines.join("\n") : "- Hub 未提供 sourceTask 摘要。";
}

function normalizeTaskType(value: string | undefined): {
  taskType: HubTaskType;
  rawTaskType?: string;
} {
  if (!value) return { taskType: "standard" };
  const normalized = value.toLowerCase();
  if (
    normalized === "quick" ||
    normalized === "standard" ||
    normalized === "change"
  ) {
    return { taskType: normalized };
  }
  return { taskType: "standard", rawTaskType: value };
}

function normalizeSourceTask(
  value: unknown,
): HubSourceTaskSummary | undefined {
  if (typeof value === "string") {
    const id = stringValue(value);
    return id ? { id } : undefined;
  }
  if (!isRecord(value)) return undefined;

  const summary: HubSourceTaskSummary = {};
  const id = firstString(value, ["id", "taskId"]);
  if (id) summary.id = id;
  const remoteTaskId = firstString(value, ["remoteTaskId", "remoteId"]);
  if (remoteTaskId) summary.remoteTaskId = remoteTaskId;
  const localTaskId = stringValue(value.localTaskId);
  if (localTaskId) summary.localTaskId = localTaskId;
  const localTaskPath = stringValue(value.localTaskPath);
  if (localTaskPath) summary.localTaskPath = localTaskPath;
  const title = firstString(value, ["title", "name"]);
  if (title) summary.title = title;
  const requirementId = stringValue(value.requirementId);
  if (requirementId) summary.requirementId = requirementId;
  const requirementRevision =
    numberValue(value.requirementRevision) ?? numberValue(value.revision);
  if (requirementRevision !== undefined) {
    summary.requirementRevision = requirementRevision;
  }
  const status = stringValue(value.status);
  if (status) summary.status = status;
  const completedAt = stringValue(value.completedAt);
  if (completedAt) summary.completedAt = completedAt;
  const sourceSummary = firstString(value, ["summary"]);
  if (sourceSummary) summary.summary = sourceSummary;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function formatRequirementList(requirements: readonly HubRequirement[]): string {
  if (requirements.length === 0) return "";
  return ` ${requirements
    .map((item) => `${item.id}${item.title ? `(${item.title})` : ""}`)
    .join(", ")}`;
}

function slugifyAscii(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug || "requirement";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}
