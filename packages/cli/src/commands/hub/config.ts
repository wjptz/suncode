import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES, FILE_NAMES } from "../../constants/paths.js";
import {
  getHubSession,
  isHubSessionExpired,
  loadGlobalHubConfig,
  normalizeApiBaseUrl,
} from "./auth.js";
import type {
  HubConfig,
  HubEngineerReviewConfig,
  HubReviewConfig,
  HubReviewProvider,
  HubReviewTrigger,
  HubReviewUnavailablePolicy,
  StartReviewPolicy,
} from "./types.js";

interface HubReviewSection {
  enabled?: boolean;
  provider?: string;
  required?: boolean;
  trigger?: string;
  unavailablePolicy?: string;
  engineer?: Partial<HubEngineerReviewConfig>;
}

interface HubSection {
  enabled?: boolean;
  mode?: string;
  projectId?: string;
  developerId?: string;
  apiBaseUrl?: string;
  startReviewPolicy?: string;
  review?: HubReviewSection;
}

export class HubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConfigError";
  }
}

export interface ResolveHubConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  requireAuth?: boolean;
  homeDir?: string;
}

export const DEFAULT_HUB_REVIEW_CONFIG: HubReviewConfig = {
  enabled: false,
  provider: "engineer",
  required: false,
  trigger: "manual",
  unavailablePolicy: "bypass",
  engineer: {
    command: "engineer",
    args: ["run"],
    timeoutSeconds: 900,
    saveRawOutput: true,
  },
};

export function parseHubSection(content: string): HubSection {
  const lines = content.split("\n");
  const parsed: HubSection = {};
  let inHub = false;
  let inReview = false;
  let inReviewEngineer = false;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmedRight = line.trimEnd();
    if (trimmedRight.trim() === "" || trimmedRight.trimStart().startsWith("#")) {
      continue;
    }

    if (/^hub:\s*$/.test(trimmedRight)) {
      inHub = true;
      continue;
    }

    if (inHub && /^\S/.test(trimmedRight)) {
      break;
    }

    if (!inHub) continue;

    const engineerMatch = trimmedRight.match(
      /^ {6}([A-Za-z][\w]*):\s*(.*)$/,
    );
    if (inReviewEngineer && engineerMatch) {
      parsed.review ??= {};
      parsed.review.engineer ??= {};
      const [, key, rawValue] = engineerMatch;
      const value = stripYamlScalar(rawValue);
      if (value === "" || value === "null" || value === "~") continue;
      switch (key) {
        case "command":
          parsed.review.engineer.command = value;
          break;
        case "args":
          parsed.review.engineer.args = parseYamlStringArray(value, "hub.review.engineer.args");
          break;
        case "timeoutSeconds":
          parsed.review.engineer.timeoutSeconds = parsePositiveInteger(
            value,
            "hub.review.engineer.timeoutSeconds",
          );
          break;
        case "saveRawOutput":
          parsed.review.engineer.saveRawOutput = parseYamlBool(
            value,
            "hub.review.engineer.saveRawOutput",
          );
          break;
        default:
          break;
      }
      continue;
    }

    const reviewMatch = trimmedRight.match(/^ {4}([A-Za-z][\w]*):\s*(.*)$/);
    if (inReview && reviewMatch) {
      inReviewEngineer = false;
      parsed.review ??= {};
      const [, key, rawValue] = reviewMatch;
      const value = stripYamlScalar(rawValue);
      if (key === "engineer" && (value === "" || value === "null" || value === "~")) {
        parsed.review.engineer ??= {};
        inReviewEngineer = true;
        continue;
      }
      if (value === "" || value === "null" || value === "~") continue;
      switch (key) {
        case "enabled":
          parsed.review.enabled = parseYamlBool(value, "hub.review.enabled");
          break;
        case "required":
          parsed.review.required = parseYamlBool(value, "hub.review.required");
          break;
        case "provider":
        case "trigger":
        case "unavailablePolicy":
          parsed.review[key] = value;
          break;
        default:
          break;
      }
      continue;
    }

    const match = trimmedRight.match(/^ {2}([A-Za-z][\w]*):\s*(.*)$/);
    if (!match) continue;

    inReview = false;
    inReviewEngineer = false;
    const [, key, rawValue] = match;
    const value = stripYamlScalar(rawValue);
    if (key === "review" && (value === "" || value === "null" || value === "~")) {
      parsed.review ??= {};
      inReview = true;
      continue;
    }
    if (value === "" || value === "null" || value === "~") continue;

    switch (key) {
      case "enabled":
        parsed.enabled = parseYamlBool(value, "hub.enabled");
        break;
      case "mode":
      case "projectId":
      case "developerId":
      case "apiBaseUrl":
      case "startReviewPolicy":
        parsed[key] = value;
        break;
      default:
        break;
    }
  }

  return parsed;
}

export function resolveHubConfig(
  options: ResolveHubConfigOptions = {},
): HubConfig {
  const cwd = options.cwd ?? process.cwd();
  const requireAuth = options.requireAuth ?? true;
  const env = options.env ?? process.env;
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");

  if (!fs.existsSync(configPath)) {
    return {
      enabled: false,
      cwd,
      configPath,
      reason: ".suncode/config.yaml not found",
    };
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const hub = parseHubSection(content);
  if (hub.enabled !== true) {
    return {
      enabled: false,
      cwd,
      configPath,
      reason: "hub.enabled is not true",
    };
  }

  if (hub.mode && hub.mode !== "team") {
    throw new HubConfigError(
      `hub.mode must be "team" when hub.enabled is true (got ${hub.mode})`,
    );
  }
  if (!hub.projectId) {
    throw new HubConfigError("hub.projectId is required when hub.enabled is true");
  }

  const globalConfig = loadGlobalHubConfig({ homeDir: options.homeDir });
  const apiBaseUrlSource = hub.apiBaseUrl ? "project" : "global";
  const rawApiBaseUrl = hub.apiBaseUrl ?? globalConfig.defaultApiBaseUrl;
  if (!rawApiBaseUrl) {
    throw new HubConfigError(
      "Hub apiBaseUrl is required. Run `suncode hub init` to set the global default, or set hub.apiBaseUrl for this project.",
    );
  }
  const apiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl);
  const session = getHubSession(apiBaseUrl, { homeDir: options.homeDir });
  if (requireAuth && !session) {
    throw new HubConfigError(
      `Hub login is required for ${apiBaseUrl}. Run \`suncode hub login\`.`,
    );
  }
  if (requireAuth && session && isHubSessionExpired(session)) {
    throw new HubConfigError(
      `Hub login for ${apiBaseUrl} is expired. Run \`suncode hub login\`.`,
    );
  }

  const developerId =
    hub.developerId ??
    session?.developerId ??
    env.SUNCODE_HUB_DEVELOPER_ID ??
    readDeveloperName(cwd) ??
    "unknown";

  return {
    enabled: true,
    cwd,
    configPath,
    mode: "team",
    projectId: hub.projectId,
    apiBaseUrl,
    apiBaseUrlSource,
    developerId,
    ...(session?.token ? { token: session.token } : {}),
    startReviewPolicy: parseStartReviewPolicy(hub.startReviewPolicy),
    review: parseHubReviewConfig(hub.review),
  };
}

function stripYamlScalar(value: string): string {
  const withoutComment = stripInlineComment(value).trim();
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
      continue;
    }
    if (ch === "#" && quote === null && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

function parseYamlBool(value: string, field: string): boolean {
  const normalized = value.toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  throw new HubConfigError(`${field} must be a boolean (got ${value})`);
}

function parseYamlStringArray(value: string, field: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    return value.trim() ? [value] : [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new HubConfigError(`${field} must be a string array.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HubConfigError(`${field} must be a positive integer.`);
  }
  return parsed;
}

function parseStartReviewPolicy(value: string | undefined): StartReviewPolicy {
  if (value === undefined || value === "") return "confirm";
  if (value === "confirm" || value === "block" || value === "bypass") {
    return value;
  }
  throw new HubConfigError(
    `hub.startReviewPolicy must be confirm, block, or bypass (got ${value})`,
  );
}

function parseHubReviewConfig(value: HubReviewSection | undefined): HubReviewConfig {
  return {
    enabled: value?.enabled ?? DEFAULT_HUB_REVIEW_CONFIG.enabled,
    provider: parseReviewProvider(value?.provider),
    required: value?.required ?? DEFAULT_HUB_REVIEW_CONFIG.required,
    trigger: parseReviewTrigger(value?.trigger),
    unavailablePolicy: parseReviewUnavailablePolicy(value?.unavailablePolicy),
    engineer: {
      command:
        value?.engineer?.command ??
        DEFAULT_HUB_REVIEW_CONFIG.engineer.command,
      args:
        value?.engineer?.args ?? [...DEFAULT_HUB_REVIEW_CONFIG.engineer.args],
      timeoutSeconds:
        value?.engineer?.timeoutSeconds ??
        DEFAULT_HUB_REVIEW_CONFIG.engineer.timeoutSeconds,
      saveRawOutput:
        value?.engineer?.saveRawOutput ??
        DEFAULT_HUB_REVIEW_CONFIG.engineer.saveRawOutput,
    },
  };
}

function parseReviewProvider(
  value: string | undefined,
): HubReviewProvider {
  if (value === undefined || value === "") return "engineer";
  if (value === "engineer") return value;
  throw new HubConfigError(
    `hub.review.provider must be engineer (got ${value})`,
  );
}

function parseReviewTrigger(value: string | undefined): HubReviewTrigger {
  if (value === undefined || value === "") return "manual";
  if (value === "manual" || value === "beforeCompletion") return value;
  throw new HubConfigError(
    `hub.review.trigger must be manual or beforeCompletion (got ${value})`,
  );
}

function parseReviewUnavailablePolicy(
  value: string | undefined,
): HubReviewUnavailablePolicy {
  if (value === undefined || value === "") return "bypass";
  if (value === "bypass" || value === "warn" || value === "block") {
    return value;
  }
  throw new HubConfigError(
    `hub.review.unavailablePolicy must be bypass, warn, or block (got ${value})`,
  );
}

function readDeveloperName(cwd: string): string | undefined {
  const filePath = path.join(
    cwd,
    DIR_NAMES.WORKFLOW,
    FILE_NAMES.DEVELOPER,
  );
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    if (line.startsWith("name=")) {
      const name = line.split("=", 2)[1]?.trim();
      if (name) return name;
    }
  }
  return undefined;
}
