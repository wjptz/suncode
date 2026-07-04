import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveHubConfig } from "./config.js";
import { markTaskStatus } from "./lifecycle.js";
import { loadHubManifest } from "./manifest.js";
import {
  collectReviewCodeSnapshot,
  snapshotsMatch,
  type ReviewCodeSnapshot,
} from "./review-state.js";
import {
  submitReviewArtifacts,
  type HubReviewSubmissionSummary,
} from "./submissions.js";
import { readHubTask } from "./task.js";
import type {
  FetchLike,
  HubCommandResult,
  HubReviewConfig,
  HubReviewProvider,
  HubReviewStatus,
} from "./types.js";
import { toPosix } from "../../utils/posix.js";

const REVIEW_PROVIDER_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface ReviewProviderRunOptions {
  cwd: string;
  prompt: string;
  promptPath: string;
  timeoutSeconds: number;
}

export interface ReviewProviderRunResult {
  exitCode: number;
  output: string;
}

export interface ReviewProviderAdapter {
  name: HubReviewProvider;
  isAvailable: () => boolean | Promise<boolean>;
  run: (options: ReviewProviderRunOptions) => Promise<ReviewProviderRunResult>;
}

export interface HubReviewOptions {
  cwd?: string;
  taskJsonPath: string;
  modules?: readonly string[];
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  provider?: ReviewProviderAdapter;
}

interface ParsedProviderReview {
  status: HubReviewStatus;
  summary: string;
  mustFix: ReviewIssue[];
  advisory: ReviewIssue[];
  mustFixCount: number;
  advisoryCount: number;
}

interface ReviewIssue {
  severity?: string;
  file?: string;
  line?: number;
  title: string;
  detail?: string;
}

interface ReviewJson {
  version: 1;
  round: number;
  provider: HubReviewProvider;
  status: HubReviewStatus;
  scope: string[];
  baseRef?: string;
  headCommit?: string;
  diffHash: string;
  startedAt: string;
  finishedAt: string;
  summary: string;
  mustFix: ReviewIssue[];
  advisory: ReviewIssue[];
  mustFixCount: number;
  advisoryCount: number;
  artifacts: {
    prompt: string;
    result: string;
    diff: string;
    rawOutput?: string;
  };
}

export async function hubReview(
  options: HubReviewOptions,
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
  if (!config.review.enabled) {
    return { status: "skipped", message: "Hub review is disabled." };
  }

  const task = readHubTask(options.taskJsonPath, cwd);
  if (task.meta.taskType === "quick") {
    return { status: "skipped", message: "quick task skips Hub review." };
  }
  const manifest = loadHubManifest(task.taskDir);
  const remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId;
  if (!remoteTaskId) {
    return { status: "skipped", message: "Task is not bound to Hub." };
  }

  const provider =
    options.provider ?? createEngineerReviewProvider(config.review);
  const available = await provider.isAvailable();
  if (!available) {
    if (config.review.unavailablePolicy === "block") {
      throw new Error(`Review provider ${provider.name} is unavailable.`);
    }
    return {
      status: "skipped",
      message: `Review provider ${provider.name} is unavailable.`,
    };
  }

  const round = Math.max(
    nextReviewRound(task.taskDir),
    (manifest.lastReviewRound ?? 0) + 1,
  );
  const roundName = reviewRoundName(round);
  const roundDir = path.join(task.taskDir, "reviews", roundName);
  fs.mkdirSync(roundDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const before = collectReviewCodeSnapshot(cwd);
  const resultPath = path.join(roundDir, "result.md");
  const prompt = buildReviewPrompt({
    cwd,
    taskDir: task.taskDir,
    resultPath,
    scope: [...(options.modules ?? [])],
    reviewAreas: reviewDirectoryHints(before.diff),
    previousReviewPath: previousReviewPath(cwd, task.taskDir, round - 1),
  });
  const promptPath = path.join(roundDir, "prompt.md");
  const rawOutputPath = path.join(roundDir, "raw-output.md");
  const diffPath = path.join(roundDir, "diff.patch");
  fs.writeFileSync(promptPath, prompt, "utf-8");
  fs.writeFileSync(diffPath, before.diff, "utf-8");

  await markTaskStatus({
    cwd,
    taskJsonPath: task.taskJsonPath,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    status: "in_review",
    idempotencyPrefix: "hub:review-status",
  });

  const providerResult = await runReviewProvider(provider, {
    cwd,
    prompt,
    promptPath,
    timeoutSeconds: config.review.engineer.timeoutSeconds,
  });
  if (config.review.engineer.saveRawOutput) {
    fs.writeFileSync(rawOutputPath, providerResult.output, "utf-8");
  }

  const after = collectReviewCodeSnapshot(cwd);
  const parsed = parseProviderReview(providerResult);
  const finalReview = snapshotsMatch(before, after)
    ? parsed
    : {
        status: "blocked" as const,
        summary: "Review provider modified the worktree during review.",
        mustFix: [
          {
            severity: "high",
            title: "Review provider modified the worktree",
            detail:
              "Hub review is report-only. Re-run review after restoring or accepting intentional local changes.",
          },
        ],
        advisory: parsed.advisory,
        mustFixCount: 1,
        advisoryCount: parsed.advisoryCount,
      };
  const finishedAt = new Date().toISOString();
  fs.writeFileSync(
    resultPath,
    renderReviewResultMarkdown({
      round,
      provider: provider.name,
      scope: [...(options.modules ?? [])],
      review: finalReview,
    }),
    "utf-8",
  );
  const reviewJson = buildReviewJson({
    round,
    provider: provider.name,
    status: finalReview.status,
    scope: [...(options.modules ?? [])],
    snapshot: after,
    startedAt,
    finishedAt,
    summary: finalReview.summary,
    mustFix: finalReview.mustFix,
    mustFixCount: finalReview.mustFixCount,
    advisory: finalReview.advisory,
    advisoryCount: finalReview.advisoryCount,
    baseRef: stringField(task.task.base_branch),
    includeRawOutput: config.review.engineer.saveRawOutput,
  });
  fs.writeFileSync(
    path.join(roundDir, "review.json"),
    `${JSON.stringify(reviewJson, null, 2)}\n`,
    "utf-8",
  );

  await submitReviewArtifacts({
    cwd,
    homeDir: options.homeDir,
    env: options.env,
    taskJsonPath: task.taskJsonPath,
    fetch: options.fetch,
    force: true,
    round,
    review: reviewSubmissionSummary(reviewJson),
  });

  await markTaskStatus({
    cwd,
    taskJsonPath: task.taskJsonPath,
    env: options.env,
    homeDir: options.homeDir,
    fetch: options.fetch,
    status: hubTaskStatusAfterReview(finalReview),
    idempotencyPrefix: "hub:review-status",
  });

  return {
    status: "updated",
    message: `Hub review ${roundName} ${finalReview.status}.`,
  };
}

function createEngineerReviewProvider(
  config: HubReviewConfig,
): ReviewProviderAdapter {
  return {
    name: "engineer",
    isAvailable: () => commandIsAvailable(config.engineer.command),
    run: async (options) => {
      const instruction = `Review the current Suncode Hub task using this prompt file: ${options.promptPath}`;
      const result = spawnSync(
        config.engineer.command,
        [...config.engineer.args, instruction],
        {
          cwd: options.cwd,
          input: options.prompt,
          encoding: "utf-8",
          timeout: options.timeoutSeconds * 1000,
          maxBuffer: REVIEW_PROVIDER_MAX_BUFFER_BYTES,
        },
      );
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      return {
        exitCode: result.status ?? (result.error ? 1 : 0),
        output,
      };
    },
  };
}

function commandIsAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error && "code" in result.error) {
    return result.error.code !== "ENOENT";
  }
  return true;
}

async function runReviewProvider(
  provider: ReviewProviderAdapter,
  options: ReviewProviderRunOptions,
): Promise<ReviewProviderRunResult> {
  try {
    return await provider.run(options);
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildReviewPrompt(options: {
  cwd: string;
  taskDir: string;
  resultPath: string;
  scope: readonly string[];
  reviewAreas: readonly string[];
  previousReviewPath?: string;
}): string {
  return [
    "# Suncode Hub 代码审查",
    "",
    "你是本次 Hub 任务的代码审查员。审查对象是代码实现是否满足任务需求、设计和实施方案，不是评审需求、设计或实施方案本身。",
    "只审查本次 Hub 任务的代码实现；不要做全仓泛化审计；不要报告无关历史问题，除非它直接影响本次任务。",
    "只做报告，不要编辑文件、提交、合并、推送或运行破坏性命令。",
    "不要运行编译、测试、lint、format、代码生成、安装依赖或其他验证/构建命令；这些验证应由开发流程完成，你只需读取已有任务产物作为背景。",
    "",
    `任务目录：${formatPromptPath(options.cwd, options.taskDir)}`,
    "",
    "任务/需求文件：",
    ...taskDocumentReferences(options.cwd, options.taskDir),
    "",
    ...previousReviewReference(options.previousReviewPath),
    ...reviewAreaHint(options.reviewAreas),
    "请读取任务文件和范围提示下的相关模块代码，重点从需求视角核查实现质量：",
    "- 功能完整性：需求、验收标准、变更点是否都由代码覆盖，没有漏实现或误实现。",
    "- 逻辑正确性：核心分支、状态流转、数据归一化、错误路径和回退策略是否符合需求。",
    "- 边界条件：空值、缺失字段、未知枚举、重复调用、旧数据兼容和异常响应是否处理合理。",
    "- 数据流与接口契约：输入输出、持久化字段、上传/提交 payload、幂等键和调用顺序是否一致。",
    "- 用户可见行为：CLI 提示、产物生成、跳过/阻塞语义是否清晰且不会误导后续流程。",
    "- 安全与副作用：是否避免泄露敏感信息，是否避免越权写入、误上传、误状态变更或扩大修改范围。",
    "- 可维护性：实现是否遵循现有模块边界和本地模式，没有引入不必要复杂度或重复逻辑。",
    "",
    "输出要求：",
    "- 只返回一个 fenced JSON 代码块，不要输出其他 Markdown 正文。",
    "- 描述性字段必须使用中文，包括 `summary`、`title` 和 `detail`。",
    "- `status` 只能是 `approved`、`changes_requested` 或 `blocked`。",
    `- CLI 会根据你的 JSON 生成 ${formatPromptPath(options.cwd, options.resultPath)}；不要直接写入或编辑 result.md / review.json。`,
    "- result.md 会由 CLI 渲染为 Summary / Must Fix / Advisory 等固定章节。",
    "",
    "固定字段：",
    "- `status`: `approved`、`changes_requested` 或 `blocked`。",
    "- `summary`: 一句中文审查结论。",
    "- `mustFix`: 必须修复问题数组；每项可包含 `severity`、`file`、`line`、`title`、`detail`。",
    "- `advisory`: 建议项数组；每项可包含 `severity`、`file`、`line`、`title`、`detail`。",
    "- `mustFixCount`: 必须修复问题数量。",
    "- `advisoryCount`: 建议项数量。",
    "",
    ...renderScopeHint(options.scope),
  ].join("\n");
}

function renderScopeHint(scope: readonly string[]): string[] {
  if (scope.length === 0) return [];
  return [`用户显式 scope hint：${scope.join(", ")}`, ""];
}

function taskDocumentReferences(cwd: string, taskDir: string): string[] {
  const files = [
    "task.json",
    "prd.md",
    "design.md",
    "implement.md",
    "subtasks.json",
  ];
  return files.flatMap((file) => {
    const filePath = path.join(taskDir, file);
    if (!fs.existsSync(filePath)) return [];
    return [`- ${formatPromptPath(cwd, filePath)}`];
  });
}

function previousReviewReference(previousReview?: string): string[] {
  if (!previousReview) return [];
  return ["上一轮 review 文件：", `- ${previousReview}`, ""];
}

function reviewAreaHint(reviewAreas: readonly string[]): string[] {
  if (reviewAreas.length === 0) return [];
  return [
    "代码审查范围提示（目录级，非文件清单）：",
    ...reviewAreas.map((area) => `- ${area}`),
    "",
  ];
}

function reviewDirectoryHints(diff: string): string[] {
  const limit = 12;
  const directories = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    const changedPath = normalizeDiffPath(match[2] ?? match[1]);
    if (!changedPath) continue;
    const directory = path.posix.dirname(changedPath);
    directories.add(directory === "." ? "repository-root" : directory);
    if (directories.size >= limit) break;
  }
  return [...directories].sort();
}

function normalizeDiffPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/dev/null") return undefined;
  return toPosix(trimmed.replace(/^"|"$/g, ""));
}

function formatPromptPath(cwd: string, filePath: string): string {
  const relativePath = path.relative(cwd, filePath);
  const displayPath =
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
      ? relativePath
      : filePath;
  return toPosix(displayPath);
}

function parseProviderReview(
  result: ReviewProviderRunResult,
): ParsedProviderReview {
  if (result.exitCode !== 0) {
    return {
      status: "blocked",
      summary: "Review provider failed before returning a structured result.",
      mustFix: [
        {
          severity: "high",
          title: "Review provider failed",
          detail:
            "Check raw-output.md when raw output saving is enabled, then re-run `suncode hub review`.",
        },
      ],
      mustFixCount: 1,
      advisory: [],
      advisoryCount: 0,
    };
  }

  const parsed = parseJsonBlock(result.output);
  if (!parsed) {
    return {
      status: "blocked",
      summary: "Review provider did not return a valid JSON result.",
      mustFix: [
        {
          severity: "high",
          title: "Review provider did not return valid JSON",
          detail:
            "The provider must return one fenced JSON block with status, summary, mustFix, and advisory fields.",
        },
      ],
      mustFixCount: 1,
      advisory: [],
      advisoryCount: 0,
    };
  }

  const mustFix = normalizeIssues(parsed.mustFix ?? parsed.must_fix);
  const advisory = normalizeIssues(parsed.advisory);

  return {
    status: reviewStatusValue(parsed.status),
    summary: stringValue(parsed.summary) ?? "Review completed.",
    mustFix,
    advisory,
    mustFixCount: issueCount(mustFix, parsed.mustFixCount),
    advisoryCount: issueCount(advisory, parsed.advisoryCount),
  };
}

function parseJsonBlock(output: string): Record<string, unknown> | undefined {
  const fencedBlocks = [...output.matchAll(/```json\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .reverse();
  for (const block of fencedBlocks) {
    const parsed = parseJsonObject(block);
    if (parsed) return parsed;
  }

  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  const jsonText = start >= 0 && end >= start ? output.slice(start, end + 1) : "";
  return parseJsonObject(jsonText);
}

function parseJsonObject(
  jsonText: string | undefined,
): Record<string, unknown> | undefined {
  if (!jsonText?.trim()) return undefined;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function reviewStatusValue(value: unknown): HubReviewStatus {
  if (
    value === "approved" ||
    value === "changes_requested" ||
    value === "blocked"
  ) {
    return value;
  }
  return "blocked";
}

function hubTaskStatusAfterReview(review: ParsedProviderReview): string {
  return review.status === "approved" ? "in_review" : "in_progress";
}

function issueCount(value: readonly ReviewIssue[], explicit: unknown): number {
  if (value.length > 0) return value.length;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  return 0;
}

function normalizeIssues(value: unknown): ReviewIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    const normalized = normalizeIssue(issue);
    return normalized ? [normalized] : [];
  });
}

function normalizeIssue(value: unknown): ReviewIssue | undefined {
  if (typeof value === "string") {
    const title = value.trim();
    return title ? { title } : undefined;
  }
  if (!isRecord(value)) return undefined;

  const file = stringValue(value.file) ?? stringValue(value.path);
  const title =
    stringValue(value.title) ??
    stringValue(value.summary) ??
    stringValue(value.message) ??
    stringValue(value.description) ??
    stringValue(value.detail) ??
    (file ? `Issue in ${file}` : undefined);
  if (!title) return undefined;

  const detail =
    stringValue(value.detail) ??
    stringValue(value.description) ??
    stringValue(value.message);
  const severity = stringValue(value.severity);
  const line = positiveIntegerValue(value.line);
  return {
    ...(severity ? { severity } : {}),
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
    title,
    ...(detail && detail !== title ? { detail } : {}),
  };
}

function renderReviewResultMarkdown(options: {
  round: number;
  provider: HubReviewProvider;
  scope: readonly string[];
  review: ParsedProviderReview;
}): string {
  const lines = [
    "# Hub Review Result",
    "",
    `Round: ${options.round}`,
    `Provider: ${options.provider}`,
    `Status: ${options.review.status}`,
    `Scope: ${options.scope.length > 0 ? options.scope.join(", ") : "provider-selected"}`,
    "",
    "## Summary",
    "",
    options.review.summary,
    "",
    "## Must Fix",
    "",
    ...renderIssueSection(
      options.review.mustFix,
      "No must-fix issues reported.",
    ),
    "",
    "## Advisory",
    "",
    ...renderIssueSection(
      options.review.advisory,
      "No advisory issues reported.",
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function renderIssueSection(
  issues: readonly ReviewIssue[],
  emptyText: string,
): string[] {
  if (issues.length === 0) return [emptyText];
  return issues.flatMap((issue, index) => {
    const lines = [`${index + 1}. ${formatIssueTitle(issue)}`];
    const location = formatIssueLocation(issue);
    if (location) lines.push(`   Location: ${location}`);
    if (issue.detail) lines.push(`   Detail: ${issue.detail}`);
    return lines;
  });
}

function formatIssueTitle(issue: ReviewIssue): string {
  return issue.severity ? `[${issue.severity}] ${issue.title}` : issue.title;
}

function formatIssueLocation(issue: ReviewIssue): string | undefined {
  if (!issue.file) return undefined;
  return issue.line ? `${issue.file}:${issue.line}` : issue.file;
}

function buildReviewJson(options: {
  round: number;
  provider: HubReviewProvider;
  status: HubReviewStatus;
  scope: string[];
  snapshot: ReviewCodeSnapshot;
  startedAt: string;
  finishedAt: string;
  summary: string;
  mustFix: ReviewIssue[];
  mustFixCount: number;
  advisory: ReviewIssue[];
  advisoryCount: number;
  baseRef?: string;
  includeRawOutput: boolean;
}): ReviewJson {
  const roundName = reviewRoundName(options.round);
  return {
    version: 1,
    round: options.round,
    provider: options.provider,
    status: options.status,
    scope: options.scope,
    ...(options.baseRef ? { baseRef: options.baseRef } : {}),
    ...(options.snapshot.headCommit
      ? { headCommit: options.snapshot.headCommit }
      : {}),
    diffHash: options.snapshot.diffHash,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    summary: options.summary,
    mustFix: options.mustFix,
    advisory: options.advisory,
    mustFixCount: options.mustFixCount,
    advisoryCount: options.advisoryCount,
    artifacts: {
      prompt: `reviews/${roundName}/prompt.md`,
      result: `reviews/${roundName}/result.md`,
      diff: `reviews/${roundName}/diff.patch`,
      ...(options.includeRawOutput
        ? { rawOutput: `reviews/${roundName}/raw-output.md` }
        : {}),
    },
  };
}

function reviewSubmissionSummary(
  review: ReviewJson,
): HubReviewSubmissionSummary {
  return {
    round: review.round,
    provider: review.provider,
    status: review.status,
    diffHash: review.diffHash,
    ...(review.headCommit ? { headCommit: review.headCommit } : {}),
    summary: review.summary,
    mustFixCount: review.mustFixCount,
    advisoryCount: review.advisoryCount,
  };
}

function nextReviewRound(taskDir: string): number {
  const reviewsDir = path.join(taskDir, "reviews");
  if (!fs.existsSync(reviewsDir)) return 1;
  const rounds = fs
    .readdirSync(reviewsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^round-(\d+)$/.exec(entry.name)?.[1])
    .flatMap((value) => (value ? [Number(value)] : []))
    .filter((value) => Number.isInteger(value));
  return rounds.length === 0 ? 1 : Math.max(...rounds) + 1;
}

function previousReviewPath(
  cwd: string,
  taskDir: string,
  round: number,
): string | undefined {
  if (round < 1) return undefined;
  const filePath = path.join(
    taskDir,
    "reviews",
    reviewRoundName(round),
    "review.json",
  );
  if (!fs.existsSync(filePath)) return undefined;
  return formatPromptPath(cwd, filePath);
}

function reviewRoundName(round: number): string {
  return `round-${String(round).padStart(3, "0")}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return stringValue(value);
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
