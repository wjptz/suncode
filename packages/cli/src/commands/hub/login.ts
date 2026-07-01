import inquirer from "inquirer";

import {
  clearHubSession,
  loadGlobalHubConfig,
  normalizeApiBaseUrl,
  setHubSession,
  type HubHomeOptions,
} from "./auth.js";
import { parseHubSection } from "./config.js";
import { DIR_NAMES } from "../../constants/paths.js";
import type { FetchLike, HubCommandResult } from "./types.js";
import fs from "node:fs";
import path from "node:path";

export interface HubLoginOptions extends HubHomeOptions {
  cwd?: string;
  apiBaseUrl?: string;
  email?: string;
  username?: string;
  password?: string;
  fetch?: FetchLike;
}

export interface HubLogoutOptions extends HubHomeOptions {
  cwd?: string;
  apiBaseUrl?: string;
}

interface LoginResponse {
  token?: string;
  expiresAt?: string;
  developerId?: string;
  displayName?: string;
  user?: {
    id?: string | number;
    email?: string;
    display_name?: string;
    displayName?: string;
  };
}

export async function hubLogin(
  options: HubLoginOptions = {},
): Promise<HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const apiBaseUrl = resolveLoginApiBaseUrl(cwd, options);
  const credentials = await resolveCredentials(options);
  const response = await (options.fetch ?? fetch)(
    `${apiBaseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(credentials),
    },
  );
  if (!response.ok) {
    throw new Error(`Hub login failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as LoginResponse;
  const session = normalizeLoginResponse(payload);
  if (!session) {
    throw new Error("Hub login response must include token and user.id.");
  }

  setHubSession(
    apiBaseUrl,
    {
      developerId: session.developerId,
      token: session.token,
      loggedInAt: new Date().toISOString(),
      ...(session.displayName ? { displayName: session.displayName } : {}),
      ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    },
    { homeDir: options.homeDir },
  );

  return {
    status: "updated",
    message: `Logged in to ${apiBaseUrl} as ${session.displayName ?? session.developerId}`,
  };
}

export function hubLogout(
  options: HubLogoutOptions = {},
): HubCommandResult {
  const cwd = options.cwd ?? process.cwd();
  const apiBaseUrl = resolveLoginApiBaseUrl(cwd, options);
  const existed = clearHubSession(apiBaseUrl, { homeDir: options.homeDir });
  return {
    status: existed ? "updated" : "skipped",
    message: existed
      ? `Logged out from ${apiBaseUrl}`
      : `No Hub login found for ${apiBaseUrl}`,
  };
}

export function resolveLoginApiBaseUrl(
  cwd: string,
  options: HubHomeOptions & { apiBaseUrl?: string } = {},
): string {
  if (options.apiBaseUrl) return normalizeApiBaseUrl(options.apiBaseUrl);
  const projectApiBaseUrl = readProjectApiBaseUrl(cwd);
  if (projectApiBaseUrl) return normalizeApiBaseUrl(projectApiBaseUrl);
  const globalConfig = loadGlobalHubConfig({ homeDir: options.homeDir });
  if (globalConfig.defaultApiBaseUrl) return globalConfig.defaultApiBaseUrl;
  throw new Error(
    "Hub apiBaseUrl is not configured. Run `suncode hub init` or pass --api-base-url.",
  );
}

async function resolveCredentials(options: HubLoginOptions): Promise<{
  email: string;
  password: string;
}> {
  const email = options.email ?? options.username;
  if (email && options.password) {
    return { email, password: options.password };
  }
  const answers = await inquirer.prompt<{ email: string; password: string }>([
    {
      type: "input",
      name: "email",
      message: "Hub email",
      default: email,
      validate: (value: string) =>
        value.trim() ? true : "Hub email is required.",
    },
    {
      type: "password",
      name: "password",
      message: "Hub password",
      mask: "*",
      validate: (value: string) =>
        value.trim() ? true : "Hub password is required.",
    },
  ]);
  return {
    email: answers.email,
    password: answers.password,
  };
}

function normalizeLoginResponse(value: LoginResponse): {
  token: string;
  developerId: string;
  displayName?: string;
  expiresAt?: string;
} | null {
  const token = stringValue(value.token);
  if (!token) return null;
  const user = value.user;
  const developerId =
    user?.id !== undefined
      ? String(user.id)
      : stringValue(value.developerId);
  if (!developerId) return null;
  const displayName =
    stringValue(user?.display_name) ??
    stringValue(user?.displayName) ??
    stringValue(value.displayName) ??
    stringValue(user?.email);
  const expiresAt = stringValue(value.expiresAt) ?? jwtExpiresAt(token);
  return {
    token,
    developerId,
    ...(displayName ? { displayName } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function jwtExpiresAt(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as unknown;
    if (!payload || typeof payload !== "object") return undefined;
    const exp = (payload as Record<string, unknown>).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
    return new Date(exp * 1000).toISOString();
  } catch {
    return undefined;
  }
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readProjectApiBaseUrl(cwd: string): string | undefined {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  if (!fs.existsSync(configPath)) return undefined;
  return parseHubSection(fs.readFileSync(configPath, "utf-8")).apiBaseUrl;
}
