import fs from "node:fs";
import path from "node:path";

import { hubCreateTask } from "./create-task.js";
import { preflightStart } from "./lifecycle.js";
import { loadHubManifest } from "./manifest.js";
import {
  submitCompletion,
  submitPlan,
  submitSpec,
  submitSubtasks,
  type SubmitArtifactsOptions,
  type SubmitSpecOptions,
} from "./submissions.js";
import { readHubTask } from "./task.js";
import type {
  FetchLike,
  HubCommandResult,
  HubCommandStatus,
  HubTaskContext,
} from "./types.js";

export interface HubPlanReadyOptions extends SubmitArtifactsOptions {
  confirmUnapprovedReview?: boolean;
  debug?: boolean;
  logger?: (message: string) => void;
}

export type HubFinishOptions = SubmitSpecOptions;

interface WorkflowStepResult {
  name: string;
  result: HubCommandResult;
}

const REQUIRED_COMPLETION_FILES = [
  "implementation-summary.md",
  "validation-summary.md",
  "retrospective.md",
  "reuse-assessment.md",
] as const;

export async function hubPlanReady(
  options: HubPlanReadyOptions,
): Promise<HubCommandResult> {
  const tracer = createPlanReadyTracer(options);
  const commandOptions = {
    ...options,
    fetch: tracer.enabled
      ? tracePlanReadyFetch(options.fetch ?? fetch, tracer)
      : options.fetch,
  };
  tracer.log("start");
  const steps: WorkflowStepResult[] = [];
  const plan = await runPlanReadyStep("submit-plan", steps, tracer, () =>
    submitPlan(commandOptions),
  );
  if (shouldStopPlanReady(plan)) {
    tracer.log("stop after submit-plan");
    return summarizeWorkflow("plan-ready", steps);
  }

  const subtasks = await runPlanReadyStep(
    "submit-subtasks",
    steps,
    tracer,
    () => submitSubtasks(commandOptions),
  );
  if (shouldStopPlanReady(subtasks)) {
    tracer.log("stop after submit-subtasks");
    return summarizeWorkflow("plan-ready", steps);
  }

  await runPlanReadyStep("preflight-start", steps, tracer, () =>
    preflightStart({
      cwd: commandOptions.cwd,
      taskJsonPath: commandOptions.taskJsonPath,
      env: commandOptions.env,
      homeDir: commandOptions.homeDir,
      fetch: commandOptions.fetch,
      confirmUnapprovedReview: commandOptions.confirmUnapprovedReview,
    }),
  );

  tracer.log("complete");
  return summarizeWorkflow("plan-ready", steps);
}

export async function hubFinish(
  options: HubFinishOptions,
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const task = readHubTask(options.taskJsonPath, cwd);
  assertCompletionArtifactsPresent(task);

  const steps: WorkflowStepResult[] = [];
  if (!resolveRemoteTaskId(task)) {
    if (!task.meta.requirementId) {
      return {
        status: "skipped",
        message:
          "local-only task; Hub finish not applicable, use normal finish workflow.",
      };
    }
    const bind = await hubCreateTask({
      cwd,
      taskJsonPath: options.taskJsonPath,
      env: options.env,
      homeDir: options.homeDir,
      fetch: options.fetch,
    });
    if (bind.status === "disabled") {
      return bind;
    }
    steps.push({ name: "bind", result: bind });
    if (!resolveRemoteTaskId(readHubTask(options.taskJsonPath, cwd))) {
      throw new Error(
        `Hub finish binding failed: ${bind.message ?? bind.status}`,
      );
    }
  }

  const spec = await submitSpec(options);
  const completion = await submitCompletion(options);

  return summarizeWorkflow("finish", [
    ...steps,
    { name: "submit-spec", result: spec },
    { name: "submit-completion", result: completion },
  ]);
}

function resolveRemoteTaskId(task: HubTaskContext): string | undefined {
  return task.meta.remoteTaskId ?? loadHubManifest(task.taskDir).remoteTaskId;
}

function assertCompletionArtifactsPresent(task: HubTaskContext): void {
  const missing = REQUIRED_COMPLETION_FILES.filter(
    (file) => !fs.existsSync(path.join(task.taskDir, file)),
  );
  if (missing.length > 0) {
    throw new Error(`Missing completion artifacts: ${missing.join(", ")}`);
  }
}

function summarizeWorkflow(
  workflowName: string,
  steps: readonly WorkflowStepResult[],
): HubCommandResult {
  return {
    status: workflowStatus(steps.map((step) => step.result.status)),
    message: `${workflowName}: ${steps
      .map(formatWorkflowStep)
      .join("; ")}.`,
  };
}

function shouldStopPlanReady(result: HubCommandResult): boolean {
  if (result.status === "disabled") return true;
  if (result.status !== "skipped") return false;
  return !["No changed artifacts.", "No changed subtasks."].includes(
    result.message ?? "",
  );
}

function formatWorkflowStep(step: WorkflowStepResult): string {
  const message = step.result.message ? ` (${step.result.message})` : "";
  return `${step.name} ${step.result.status}${message}`;
}

function workflowStatus(statuses: readonly HubCommandStatus[]): HubCommandStatus {
  if (
    statuses.some(
      (status) =>
        status === "created" ||
        status === "submitted" ||
        status === "updated" ||
        status === "downloaded",
    )
  ) {
    return "updated";
  }
  if (statuses.length > 0 && statuses.every((status) => status === "disabled")) {
    return "disabled";
  }
  return "skipped";
}

interface PlanReadyTracer {
  enabled: boolean;
  log: (message: string) => void;
}

function createPlanReadyTracer(options: HubPlanReadyOptions): PlanReadyTracer {
  const enabled =
    options.debug === true ||
    isDebugEnabled(
      options.env?.SUNCODE_HUB_DEBUG_PLAN_READY ??
        process.env.SUNCODE_HUB_DEBUG_PLAN_READY,
    );
  const logger = options.logger ?? ((message: string) => console.error(message));
  return {
    enabled,
    log: (message: string) => {
      if (enabled) logger(`[hub plan-ready] ${message}`);
    },
  };
}

async function runPlanReadyStep(
  name: string,
  steps: WorkflowStepResult[],
  tracer: PlanReadyTracer,
  action: () => Promise<HubCommandResult>,
): Promise<HubCommandResult> {
  tracer.log(`step ${name} start`);
  try {
    const result = await action();
    steps.push({ name, result });
    tracer.log(`step ${name} ok: ${result.status}`);
    return result;
  } catch (error) {
    tracer.log(`step ${name} failed: ${errorMessage(error)}`);
    throw error;
  }
}

function tracePlanReadyFetch(
  fetchImpl: FetchLike,
  tracer: PlanReadyTracer,
): FetchLike {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
    const url = sanitizeDebugUrl(request?.url ?? String(input));
    tracer.log(`request ${method} ${url}`);
    try {
      const response = await fetchImpl(input, init);
      tracer.log(`request ${method} ${url} -> HTTP ${response.status}`);
      return response;
    } catch (error) {
      const message = errorMessage(error);
      tracer.log(`request ${method} ${url} failed: ${message}`);
      throw new Error(`plan-ready request failed: ${method} ${url}: ${message}`);
    }
  };
}

function sanitizeDebugUrl(value: string): string {
  try {
    const url = new URL(value);
    const query = url.search ? "?[redacted]" : "";
    return `${url.origin}${url.pathname}${query}${url.hash}`;
  } catch {
    return value.replace(/\?.*$/, "?[redacted]");
  }
}

function isDebugEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
