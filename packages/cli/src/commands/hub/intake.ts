import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES, FILE_NAMES } from "../../constants/paths.js";
import { toPosix } from "../../utils/posix.js";
import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { hubCreateTask } from "./create-task.js";
import { setCurrentSessionTask } from "./task.js";
import type { FetchLike, HubCommandResult } from "./types.js";

export interface HubIntakeOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  list?: boolean;
  auto?: boolean;
  requirementId?: string;
  slug?: string;
  now?: Date;
}

interface HubRequirement {
  id: string;
  title: string;
  description?: string;
  revision?: number;
  status?: string;
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

  const taskJsonPath = createLocalHubTask({
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

  return {
    status: bindResult.status,
    message: `intake: ${toPosix(path.relative(cwd, path.dirname(taskJsonPath)))}; ${bindResult.message ?? bindResult.status}`,
  };
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
  return taskJsonPath;
}

function normalizeRequirements(value: unknown): HubRequirement[] {
  const raw = extractRequirementItems(value);
  return raw.flatMap((item) => {
    const id = stringValue(item.id) ?? stringValue(item.requirementId);
    if (!id) return [];
    return [
      {
        id,
        title: stringValue(item.title) ?? id,
        description: stringValue(item.description),
        revision:
          numberValue(item.revision) ?? numberValue(item.requirementRevision),
        status: stringValue(item.status),
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
  return `# ${title}

## Hub Requirement

- ID: ${requirement.id}
- Revision: ${requirement.revision ?? "-"}
- Status: ${requirement.status ?? "-"}

## 目标

${requirement.description?.trim() ? requirement.description : requirement.title}

## 需求

- 待补充

## 验收标准

- [ ] 待补充
`;
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
