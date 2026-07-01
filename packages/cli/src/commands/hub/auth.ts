import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB_CONFIG_VERSION = 1;

export interface HubGlobalConfig {
  version: 1;
  defaultApiBaseUrl?: string;
}

export interface HubAuthSession {
  developerId: string;
  displayName?: string;
  token: string;
  expiresAt?: string;
  loggedInAt: string;
}

export interface HubAuthFile {
  version: 1;
  sessions: Record<string, HubAuthSession>;
}

export interface HubHomeOptions {
  homeDir?: string;
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Hub apiBaseUrl is required.");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Hub apiBaseUrl must start with http:// or https://.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function hubConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".suncode", "hub", "config.json");
}

export function hubAuthPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".suncode", "hub", "auth.json");
}

export function loadGlobalHubConfig(
  options: HubHomeOptions = {},
): HubGlobalConfig {
  const filePath = hubConfigPath(options.homeDir);
  const parsed = readJsonObject(filePath);
  if (!parsed) return { version: HUB_CONFIG_VERSION };
  const defaultApiBaseUrl = stringValue(parsed.defaultApiBaseUrl);
  const normalizedDefault = defaultApiBaseUrl
    ? tryNormalizeApiBaseUrl(defaultApiBaseUrl)
    : undefined;
  return {
    version: HUB_CONFIG_VERSION,
    ...(normalizedDefault ? { defaultApiBaseUrl: normalizedDefault } : {}),
  };
}

export function saveGlobalHubConfig(
  config: HubGlobalConfig,
  options: HubHomeOptions = {},
): void {
  const filePath = hubConfigPath(options.homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: HubGlobalConfig = {
    version: HUB_CONFIG_VERSION,
    ...(config.defaultApiBaseUrl
      ? { defaultApiBaseUrl: normalizeApiBaseUrl(config.defaultApiBaseUrl) }
      : {}),
  };
  writePrivateJson(filePath, payload);
}

export function loadHubAuth(options: HubHomeOptions = {}): HubAuthFile {
  const filePath = hubAuthPath(options.homeDir);
  const parsed = readJsonObject(filePath);
  if (!parsed) return { version: HUB_CONFIG_VERSION, sessions: {} };

  const sessionsValue = parsed.sessions;
  const sessions: Record<string, HubAuthSession> = {};
  if (sessionsValue && typeof sessionsValue === "object") {
    for (const [rawBaseUrl, rawSession] of Object.entries(sessionsValue)) {
      if (!rawSession || typeof rawSession !== "object") continue;
      const record = rawSession as Record<string, unknown>;
      const token = stringValue(record.token);
      const developerId = stringValue(record.developerId);
      const loggedInAt = stringValue(record.loggedInAt);
      if (!token || !developerId || !loggedInAt) continue;
      const apiBaseUrl = tryNormalizeApiBaseUrl(rawBaseUrl);
      if (!apiBaseUrl) continue;
      sessions[apiBaseUrl] = {
        developerId,
        token,
        loggedInAt,
        ...(stringValue(record.displayName)
          ? { displayName: stringValue(record.displayName) }
          : {}),
        ...(stringValue(record.expiresAt)
          ? { expiresAt: stringValue(record.expiresAt) }
          : {}),
      };
    }
  }

  return { version: HUB_CONFIG_VERSION, sessions };
}

export function saveHubAuth(
  auth: HubAuthFile,
  options: HubHomeOptions = {},
): void {
  const filePath = hubAuthPath(options.homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writePrivateJson(filePath, {
    version: HUB_CONFIG_VERSION,
    sessions: auth.sessions,
  });
}

export function getHubSession(
  apiBaseUrl: string,
  options: HubHomeOptions = {},
): HubAuthSession | undefined {
  const auth = loadHubAuth(options);
  return auth.sessions[normalizeApiBaseUrl(apiBaseUrl)];
}

export function setHubSession(
  apiBaseUrl: string,
  session: HubAuthSession,
  options: HubHomeOptions = {},
): void {
  const auth = loadHubAuth(options);
  auth.sessions[normalizeApiBaseUrl(apiBaseUrl)] = session;
  saveHubAuth(auth, options);
}

export function clearHubSession(
  apiBaseUrl: string,
  options: HubHomeOptions = {},
): boolean {
  const auth = loadHubAuth(options);
  const normalized = normalizeApiBaseUrl(apiBaseUrl);
  const { [normalized]: removed, ...remaining } = auth.sessions;
  const existed = removed !== undefined;
  auth.sessions = remaining;
  saveHubAuth(auth, options);
  return existed;
}

export function isHubSessionExpired(
  session: HubAuthSession,
  now = Date.now(),
): boolean {
  if (!session.expiresAt) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function writePrivateJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort only; Windows and some filesystems may not support chmod.
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tryNormalizeApiBaseUrl(value: string): string | undefined {
  try {
    return normalizeApiBaseUrl(value);
  } catch {
    return undefined;
  }
}
