import { resolveHubConfig } from "./config.js";
import type { HubCommandResult } from "./types.js";

export interface HubStatusOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export function hubStatus(options: HubStatusOptions = {}): HubCommandResult {
  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: false,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }
  return {
    status: "updated",
    message: `Hub enabled for project ${config.projectId} (${config.apiBaseUrl})`,
  };
}
