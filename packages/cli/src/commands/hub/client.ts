import type { EnabledHubConfig, FetchLike } from "./types.js";

const HUB_REQUEST_TIMEOUT_MS = 30_000;

export class HubHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "HubHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface HubApiClient {
  requestJson<T>(
    method: string,
    apiPath: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T>;
}

export function createHubApiClient(
  config: EnabledHubConfig,
  fetchImpl: FetchLike = fetch,
): HubApiClient {
  return {
    async requestJson<T>(
      method: string,
      apiPath: string,
      body?: unknown,
      idempotencyKey?: string,
    ): Promise<T> {
      const url = `${config.apiBaseUrl}/api/v1${apiPath}`;
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (config.token) headers.authorization = `Bearer ${config.token}`;
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HUB_REQUEST_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new HubHttpError(
            `Hub API request timed out after ${HUB_REQUEST_TIMEOUT_MS}ms`,
            408,
            "REQUEST_TIMEOUT",
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw await parseHubError(response);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return undefined as T;
      }

      return (await response.json()) as T;
    },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

async function parseHubError(response: Response): Promise<HubHttpError> {
  let message = `Hub API request failed with HTTP ${response.status}`;
  let code: string | undefined;
  let details: unknown;

  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (payload.error?.message) message = payload.error.message;
    if (payload.error?.code) code = payload.error.code;
    details = payload.error?.details;
  } catch {
    const text = await response.text().catch(() => "");
    if (text) message = text;
  }

  return new HubHttpError(message, response.status, code, details);
}
