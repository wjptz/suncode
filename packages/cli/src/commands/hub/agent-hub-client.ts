import { HubHttpError } from "./client.js";
import type { EnabledHubConfig, FetchLike } from "./types.js";

const AGENT_HUB_REQUEST_TIMEOUT_MS = 30_000;

export async function requestAgentHubJson<T>(
  config: EnabledHubConfig,
  method: string,
  apiPath: string,
  body: unknown,
  fetchImpl: FetchLike,
  serviceName = "agent-hub",
): Promise<T> {
  const response = await requestAgentHubRaw(
    config,
    method,
    apiPath,
    body,
    fetchImpl,
    serviceName,
  );
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function requestAgentHubRaw(
  config: EnabledHubConfig,
  method: string,
  apiPath: string,
  body: unknown,
  fetchImpl: FetchLike,
  serviceName = "agent-hub",
): Promise<Response> {
  const url = `${config.apiBaseUrl}/api/agent-hub${apiPath}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENT_HUB_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw await parseAgentHubError(response, serviceName);
    }
    return response;
  } catch (error) {
    if (isAbortError(error)) {
      throw new HubHttpError(
        `Hub ${serviceName} API request timed out after ${AGENT_HUB_REQUEST_TIMEOUT_MS}ms`,
        408,
        "REQUEST_TIMEOUT",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

async function parseAgentHubError(
  response: Response,
  serviceName: string,
): Promise<HubHttpError> {
  let message = `Hub ${serviceName} API request failed with HTTP ${response.status}`;
  let code: string | undefined;
  let details: unknown;

  try {
    const payload = (await response.json()) as {
      error?: string | { code?: string; message?: string; details?: unknown };
    };
    const errorPayload = payload.error;
    if (typeof errorPayload === "string") {
      if (errorPayload) message = errorPayload;
    } else if (errorPayload) {
      if (errorPayload.message) message = errorPayload.message;
      if (errorPayload.code) code = errorPayload.code;
      details = errorPayload.details;
    }
  } catch {
    const text = await response.text().catch(() => "");
    if (text) message = text;
  }

  return new HubHttpError(message, response.status, code, details);
}
