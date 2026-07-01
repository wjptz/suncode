import chalk from "chalk";
import type { Command } from "commander";

import { hubCreateTask } from "./create-task.js";
import { downloadHubDocument } from "./documents.js";
import { hubInit } from "./init.js";
import { preflightStart, markStarted } from "./lifecycle.js";
import { hubLogin, hubLogout } from "./login.js";
import { pullRequirements, pullReview, syncRequirement } from "./pull.js";
import {
  discardSpecDeletion,
  keepSpecDeletion,
  listSpecDeletions,
  pullHubSpecs,
} from "./specs.js";
import { hubState, printHubState } from "./state.js";
import { hubStatus } from "./status.js";
import {
  submitCompletion,
  submitPlan,
  submitSpec,
  submitSubtasks,
} from "./submissions.js";
import { resolveTaskJsonPath } from "./task.js";
import type { HubCommandResult } from "./types.js";

interface TaskOptions {
  taskJson?: string;
  task?: string;
  bestEffort?: boolean;
}

interface HubInitCliOptions {
  apiBaseUrl?: string;
  projectApiBaseUrl?: string;
  projectId?: string;
  developerId?: string;
  startReviewPolicy?: "confirm" | "block" | "bypass";
  yes?: boolean;
}

interface HubLoginCliOptions {
  apiBaseUrl?: string;
  email?: string;
  username?: string;
  password?: string;
}

interface HubLogoutCliOptions {
  apiBaseUrl?: string;
}

interface HubStateCliOptions {
  json?: boolean;
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

interface JsonCliOptions {
  json?: boolean;
}

interface KeepSpecDeletionCliOptions {
  id?: string;
  as?: string;
}

interface DiscardSpecDeletionCliOptions {
  id?: string;
}

export function registerHubCommand(program: Command): void {
  const hub = program
    .command("hub")
    .description(
      "Optional Suncode Hub team collaboration commands (requirements, task binding, artifacts, review, status)",
    );

  hub
    .command("init")
    .description("Initialize Hub configuration for this project")
    .option("--api-base-url <url>", "global default Hub API base URL")
    .option("--project-api-base-url <url>", "project-level Hub API URL override")
    .option("--project-id <id>", "Hub project ID")
    .option("--developer-id <id>", "optional Hub developer ID")
    .option(
      "--start-review-policy <policy>",
      "confirm, block, or bypass",
      "confirm",
    )
    .option("--yes", "non-interactive mode")
    .action(async (opts: HubInitCliOptions) => {
      await run(async () =>
        hubInit({
          cwd: process.cwd(),
          apiBaseUrl: opts.apiBaseUrl,
          projectApiBaseUrl: opts.projectApiBaseUrl,
          projectId: opts.projectId,
          developerId: opts.developerId,
          startReviewPolicy: opts.startReviewPolicy,
          yes: opts.yes,
        }),
      );
    });

  hub
    .command("login")
    .description("Login to Suncode Hub with email and password")
    .option("--api-base-url <url>", "Hub API base URL")
    .option("--email <email>", "Hub email")
    .option("--username <username>", "Hub email alias")
    .option("--password <password>", "Hub password")
    .action(async (opts: HubLoginCliOptions) => {
      await run(async () =>
        hubLogin({
          cwd: process.cwd(),
          apiBaseUrl: opts.apiBaseUrl,
          email: opts.email,
          username: opts.username,
          password: opts.password,
        }),
      );
    });

  hub
    .command("logout")
    .description("Logout from the current Hub service")
    .option("--api-base-url <url>", "Hub API base URL")
    .action((opts: HubLogoutCliOptions) => {
      runSync(() =>
        hubLogout({
          cwd: process.cwd(),
          apiBaseUrl: opts.apiBaseUrl,
        }),
      );
    });

  hub
    .command("state")
    .description("Show Hub config, login, service, work, and current task state")
    .option("--json", "print raw JSON")
    .action(async (opts: HubStateCliOptions) => {
      await runState(opts);
    });

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
    .command("pull-spec")
    .description("Pull the authoritative project spec bundle from Suncode Hub")
    .option("--json", "print raw JSON")
    .action(async (opts: JsonCliOptions) => {
      await runStructured(
        async () =>
          pullHubSpecs({
            cwd: process.cwd(),
          }),
        opts.json,
      );
    });

  const specDeletions = hub
    .command("spec-deletions")
    .description("Manage local candidates preserved when Hub deletes specs");

  specDeletions
    .command("list")
    .description("List preserved deleted Hub spec candidates")
    .option("--json", "print raw JSON")
    .action((opts: JsonCliOptions) => {
      runStructuredSync(
        () =>
          listSpecDeletions({
            cwd: process.cwd(),
          }),
        opts.json,
      );
    });

  specDeletions
    .command("keep")
    .description("Keep a deleted Hub spec candidate as a local-only supplement")
    .requiredOption("--id <id>", "deletion candidate ID")
    .requiredOption("--as <path>", "target path under .suncode/spec/local/")
    .action(async (opts: KeepSpecDeletionCliOptions) => {
      await run(async () =>
        keepSpecDeletion({
          cwd: process.cwd(),
          id: requireOption(opts.id, "--id"),
          asPath: requireOption(opts.as, "--as"),
        }),
      );
    });

  specDeletions
    .command("discard")
    .description("Mark a deleted Hub spec candidate as discarded")
    .requiredOption("--id <id>", "deletion candidate ID")
    .action(async (opts: DiscardSpecDeletionCliOptions) => {
      await run(async () =>
        discardSpecDeletion({
          cwd: process.cwd(),
          id: requireOption(opts.id, "--id"),
        }),
      );
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
    .command("submit-subtasks")
    .description("Submit current task structured subtasks to Hub")
    .option("--task-json <path>", "path to task.json")
    .option("--task <task>", "task directory/name fallback")
    .option("--force", "submit even when local hashes match the manifest")
    .option("--best-effort", "warn and exit 0 on failure")
    .action(async (opts: TaskOptions & { force?: boolean }) => {
      await run(
        async () =>
          submitSubtasks({
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

async function runStructured(
  action: () => Promise<unknown>,
  asJson = false,
): Promise<void> {
  try {
    const result = await action();
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printResult(result as HubCommandResult);
  } catch (error) {
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

function runStructuredSync(action: () => unknown, asJson = false): void {
  try {
    const result = action();
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printResult(result as HubCommandResult);
  } catch (error) {
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

async function runState(options: HubStateCliOptions): Promise<void> {
  try {
    const result = await hubState({ cwd: process.cwd() });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHubState(result);
    }
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

function requireOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
