import chalk from "chalk";
import type { Command } from "commander";

import { hubCreateTask } from "./create-task.js";
import { downloadHubDocument } from "./documents.js";
import { preflightStart, markStarted } from "./lifecycle.js";
import { pullRequirements, pullReview, syncRequirement } from "./pull.js";
import { hubStatus } from "./status.js";
import {
  submitCompletion,
  submitPlan,
  submitSpec,
} from "./submissions.js";
import { resolveTaskJsonPath } from "./task.js";
import type { HubCommandResult } from "./types.js";

interface TaskOptions {
  taskJson?: string;
  task?: string;
  bestEffort?: boolean;
}

interface DownloadDocumentOptions extends TaskOptions {
  payloadJson?: string;
  documentId?: string;
  filename?: string;
  contentType?: string;
  sha256?: string;
  size?: string;
  targetDir?: string;
}

export function registerHubCommand(program: Command): void {
  const hub = program
    .command("hub")
    .description(
      "Optional Suncode Hub team collaboration commands (requirements, task binding, artifacts, review, status)",
    );

  hub
    .command("status")
    .description("Show whether Hub collaboration is enabled for this project")
    .action(() => {
      runSync(() => hubStatus());
    });

  hub
    .command("pull")
    .description("Pull requirements assigned to the current developer")
    .action(async () => {
      await runJson(async () => pullRequirements());
    });

  hub
    .command("download-document")
    .description("Download a Hub document payload through a signed MinIO URL")
    .option("--payload-json <path>", "path to a text/document payload JSON file")
    .option("--document-id <id>", "Hub document ID")
    .option("--filename <name>", "document filename fallback")
    .option("--content-type <type>", "document content type fallback")
    .option("--sha256 <sha256>", "expected document sha256 fallback")
    .option("--size <bytes>", "document byte size fallback")
    .option("--target-dir <path>", "directory that will receive hub-sources/<filename>")
    .option("--task-json <path>", "task.json used as the target directory")
    .option("--task <task>", "task directory/name fallback used as the target directory")
    .action(async (opts: DownloadDocumentOptions) => {
      await runJson(async () =>
        downloadHubDocument({
          cwd: process.cwd(),
          payloadJsonPath: opts.payloadJson,
          documentId: opts.documentId,
          filename: opts.filename,
          contentType: opts.contentType,
          sha256: opts.sha256,
          size: opts.size ? Number(opts.size) : undefined,
          targetDir: opts.targetDir,
          taskJsonPath:
            opts.taskJson || opts.task
              ? resolveTaskJsonPath({
                  cwd: process.cwd(),
                  taskJsonPath: opts.taskJson,
                  task: opts.task,
                })
              : undefined,
        }),
      );
    });

  hub
    .command("create-task")
    .description("Create or bind the remote Hub task for a local Suncode task")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(async (opts: TaskOptions) => {
      await run(
        async () =>
          hubCreateTask({
            taskJsonPath: resolveTaskJsonPath({
              cwd: process.cwd(),
              taskJsonPath: opts.taskJson,
              task: opts.task,
            }),
          }),
        opts.bestEffort,
      );
    });

  hub
    .command("submit-plan")
    .description("Upload current task planning artifacts through MinIO and submit object refs to Hub")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--force", "submit even when local hashes match the manifest")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(async (opts: TaskOptions & { force?: boolean }) => {
      await run(
        async () =>
          submitPlan({
            taskJsonPath: resolveTaskJsonPath({
              cwd: process.cwd(),
              taskJsonPath: opts.taskJson,
              task: opts.task,
            }),
            force: opts.force,
          }),
        opts.bestEffort,
      );
    });

  hub
    .command("submit-spec")
    .description("Upload project-level Suncode spec artifacts through MinIO and submit object refs to Hub")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option(
      "--file <path>",
      "explicit spec file to submit (repeatable)",
      (value: string, previous: string[] | undefined) => [
        ...(previous ?? []),
        value,
      ],
      [] as string[],
    )
    .option("--force", "submit even when local hashes match the manifest")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(
      async (
        opts: TaskOptions & { force?: boolean; file?: string[] },
      ) => {
        await run(
          async () =>
            submitSpec({
              taskJsonPath: resolveTaskJsonPath({
                cwd: process.cwd(),
                taskJsonPath: opts.taskJson,
                task: opts.task,
              }),
              files: opts.file ?? [],
              force: opts.force,
            }),
          opts.bestEffort,
        );
      },
    );

  hub
    .command("submit-completion")
    .description("Upload current task completion artifacts through MinIO and submit object refs to Hub")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--force", "submit even when local hashes match the manifest")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(async (opts: TaskOptions & { force?: boolean }) => {
      await run(
        async () =>
          submitCompletion({
            taskJsonPath: resolveTaskJsonPath({
              cwd: process.cwd(),
              taskJsonPath: opts.taskJson,
              task: opts.task,
            }),
            force: opts.force,
          }),
        opts.bestEffort,
      );
    });

  hub
    .command("pull-review")
    .description("Pull Hub review comments for a bound local task")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--cursor <cursor>", "review cursor")
    .action(async (opts: TaskOptions & { cursor?: string }) => {
      await runJson(async () =>
        pullReview({
          taskJsonPath: resolveTaskJsonPath({
            cwd: process.cwd(),
            taskJsonPath: opts.taskJson,
            task: opts.task,
          }),
          cursor: opts.cursor,
        }),
      );
    });

  hub
    .command("sync")
    .description("Pull latest requirement details and requirement changes for a bound local task")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--cursor <cursor>", "requirement change cursor")
    .action(async (opts: TaskOptions & { cursor?: string }) => {
      await runJson(async () =>
        syncRequirement({
          taskJsonPath: resolveTaskJsonPath({
            cwd: process.cwd(),
            taskJsonPath: opts.taskJson,
            task: opts.task,
          }),
          cursor: opts.cursor,
        }),
      );
    });

  hub
    .command("preflight-start")
    .description("Ask Hub whether the current task can start development")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option(
      "--confirm-unapproved-review",
      "record user confirmation to start before review approval",
    )
    .action(
      async (
        opts: TaskOptions & { confirmUnapprovedReview?: boolean },
      ) => {
        await run(async () =>
          preflightStart({
            taskJsonPath: resolveTaskJsonPath({
              cwd: process.cwd(),
              taskJsonPath: opts.taskJson,
              task: opts.task,
            }),
            confirmUnapprovedReview: opts.confirmUnapprovedReview,
          }),
        );
      },
    );

  hub
    .command("mark-started")
    .description("Mark a bound Hub task as in progress")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--status <status>", "remote status", "in_progress")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(async (opts: TaskOptions & { status?: string }) => {
      await run(
        async () =>
          markStarted({
            taskJsonPath: resolveTaskJsonPath({
              cwd: process.cwd(),
              taskJsonPath: opts.taskJson,
              task: opts.task,
            }),
            status: opts.status,
          }),
        opts.bestEffort,
      );
    });
}

async function run(
  action: () => Promise<HubCommandResult>,
  bestEffort = false,
): Promise<void> {
  try {
    printResult(await action());
  } catch (error) {
    if (bestEffort) {
      console.warn(
        chalk.yellow("Warning:"),
        error instanceof Error ? error.message : error,
      );
      return;
    }
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

function runSync(action: () => HubCommandResult): void {
  try {
    printResult(action());
  } catch (error) {
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

async function runJson(action: () => Promise<unknown>): Promise<void> {
  try {
    console.log(JSON.stringify(await action(), null, 2));
  } catch (error) {
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

function printResult(result: HubCommandResult): void {
  const line = result.message ? `${result.status}: ${result.message}` : result.status;
  if (result.status === "disabled" || result.status === "skipped") {
    console.log(chalk.gray(line));
  } else {
    console.log(line);
  }
}
