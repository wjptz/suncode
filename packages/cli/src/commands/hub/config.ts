import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES, FILE_NAMES } from "../../constants/paths.js";
import {
  getHubSession,
  isHubSessionExpired,
  loadGlobalHubConfig,
  normalizeApiBaseUrl,
} from "./auth.js";
import type { HubConfig, StartReviewPolicy } from "./types.js";

interface HubSection {
  enabled?: boolean;
  mode?: string;
  projectId?: string;
  developerId?: string;
  apiBaseUrl?: string;
  startReviewPolicy?: string;
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

export function parseHubSection(content: string): HubSection {
  const lines = content.split("\n");
  const parsed: HubSection = {};
  let inHub = false;

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

    const match = trimmedRight.match(/^ {2}([A-Za-z][\w]*):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = stripYamlScalar(rawValue);
    if (value === "" || value === "null" || value === "~") continue;

    switch (key) {
      case "enabled":
        parsed.enabled = parseYamlBool(value);
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

function parseYamlBool(value: string): boolean {
  const normalized = value.toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  throw new HubConfigError(`hub.enabled must be a boolean (got ${value})`);
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
