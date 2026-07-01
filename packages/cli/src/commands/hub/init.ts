import fs from "node:fs";
import path from "node:path";

import inquirer from "inquirer";

import { DIR_NAMES } from "../../constants/paths.js";
import {
  normalizeApiBaseUrl,
  saveGlobalHubConfig,
  type HubHomeOptions,
} from "./auth.js";
import type { HubCommandResult, StartReviewPolicy } from "./types.js";

export interface HubInitOptions extends HubHomeOptions {
  cwd?: string;
  apiBaseUrl?: string;
  projectApiBaseUrl?: string;
  projectId?: string;
  developerId?: string;
  startReviewPolicy?: StartReviewPolicy;
  yes?: boolean;
}

interface HubInitAnswers {
  apiBaseUrl: string;
  pinProjectApiBaseUrl: boolean;
  projectApiBaseUrl?: string;
  projectId: string;
  developerId?: string;
  startReviewPolicy: StartReviewPolicy;
}

export async function hubInit(
  options: HubInitOptions = {},
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const answers = await resolveInitAnswers(options);
  const defaultApiBaseUrl = normalizeApiBaseUrl(answers.apiBaseUrl);
  const projectApiBaseUrl = answers.projectApiBaseUrl
    ? normalizeApiBaseUrl(answers.projectApiBaseUrl)
    : undefined;

  saveGlobalHubConfig(
    { version: 1, defaultApiBaseUrl },
    { homeDir: options.homeDir },
  );
  writeProjectHubConfig(cwd, {
    projectId: answers.projectId,
    developerId: answers.developerId,
    apiBaseUrl: projectApiBaseUrl,
    startReviewPolicy: answers.startReviewPolicy,
  });

  return {
    status: "updated",
    message: `Hub initialized for project ${answers.projectId} (${projectApiBaseUrl ?? defaultApiBaseUrl})`,
  };
}

async function resolveInitAnswers(
  options: HubInitOptions,
): Promise<HubInitAnswers> {
  if (options.yes) {
    if (!options.apiBaseUrl) {
      throw new Error("--api-base-url is required with --yes.");
    }
    if (!options.projectId) {
      throw new Error("--project-id is required with --yes.");
    }
    return {
      apiBaseUrl: options.apiBaseUrl,
      pinProjectApiBaseUrl: Boolean(options.projectApiBaseUrl),
      projectApiBaseUrl: options.projectApiBaseUrl,
      projectId: options.projectId,
      developerId: options.developerId,
      startReviewPolicy: options.startReviewPolicy ?? "confirm",
    };
  }

  const answers = await inquirer.prompt<HubInitAnswers>([
    {
      type: "input",
      name: "apiBaseUrl",
      message: "Hub API base URL",
      default: options.apiBaseUrl,
      validate: (value: string) =>
        value.trim() ? true : "Hub API base URL is required.",
    },
    {
      type: "confirm",
      name: "pinProjectApiBaseUrl",
      message: "Pin a project-level Hub API URL override?",
      default: Boolean(options.projectApiBaseUrl),
    },
    {
      type: "input",
      name: "projectApiBaseUrl",
      message: "Project Hub API base URL override",
      default: options.projectApiBaseUrl,
      when: (current: HubInitAnswers) => current.pinProjectApiBaseUrl,
    },
    {
      type: "input",
      name: "projectId",
      message: "Hub project ID",
      default: options.projectId,
      validate: (value: string) =>
        value.trim() ? true : "Hub project ID is required.",
    },
    {
      type: "input",
      name: "developerId",
      message: "Developer ID (optional)",
      default: options.developerId,
    },
    {
      type: "list",
      name: "startReviewPolicy",
      message: "Start review policy",
      choices: ["confirm", "block", "bypass"],
      default: options.startReviewPolicy ?? "confirm",
    },
  ]);
  return {
    ...answers,
    projectApiBaseUrl: answers.pinProjectApiBaseUrl
      ? answers.projectApiBaseUrl
      : undefined,
  };
}

function writeProjectHubConfig(
  cwd: string,
  options: {
    projectId: string;
    developerId?: string;
    apiBaseUrl?: string;
    startReviewPolicy: StartReviewPolicy;
  },
): void {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const existing = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : "";
  const block = renderHubBlock(options);
  const next = replaceHubBlock(existing, block);
  fs.writeFileSync(configPath, next, "utf-8");
}

function renderHubBlock(options: {
  projectId: string;
  developerId?: string;
  apiBaseUrl?: string;
  startReviewPolicy: StartReviewPolicy;
}): string {
  return [
    "hub:",
    "  enabled: true",
    "  mode: team",
    `  projectId: ${yamlString(options.projectId)}`,
    `  developerId: ${options.developerId ? yamlString(options.developerId) : "null"}`,
    ...(options.apiBaseUrl ? [`  apiBaseUrl: ${yamlString(options.apiBaseUrl)}`] : []),
    `  startReviewPolicy: ${options.startReviewPolicy}`,
    "  sync:",
    "    afterCreate: true",
    "    afterStart: true",
    "    afterFinish: false",
    "    afterArchive: true",
  ].join("\n");
}

function replaceHubBlock(content: string, block: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => /^hub:\s*$/.test(line));
  if (start === -1) {
    const prefix = normalized.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ""}${block}\n`;
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() && /^\S/.test(line)) break;
    end += 1;
  }

  const before = lines.slice(0, start).join("\n").replace(/\n+$/, "");
  const after = lines.slice(end).join("\n").replace(/^\n+/, "");
  return `${before ? `${before}\n` : ""}${block}\n${after ? `\n${after.replace(/\n*$/, "\n")}` : ""}`;
}

function yamlString(value: string): string {
  if (/^[A-Za-z0-9._:/-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
