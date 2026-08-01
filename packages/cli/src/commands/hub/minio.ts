import fs from "node:fs";
import path from "node:path";

import { hashBuffer, readNormalizedTextFile } from "./hash.js";
import { sanitizeUrlForLogging } from "./logging.js";
import type {
  FetchLike,
  HubArtifact,
  ObjectRef,
  UploadedArtifact,
} from "./types.js";

export interface UploadTarget {
  path: string;
  uploadUrl: string;
  method?: string;
  headers?: Record<string, string>;
  objectRef: ObjectRef;
}

export interface HubUploadAuth {
  apiBaseUrl: string;
  token?: string;
}

export async function uploadArtifactToMinio(
  artifact: HubArtifact,
  upload: UploadTarget,
  uploadSessionId: string,
  fetchImpl: FetchLike,
  hubAuth?: HubUploadAuth,
): Promise<UploadedArtifact> {
  const body = Buffer.from(readNormalizedTextFile(artifact.absolutePath), "utf-8");
  const method = upload.method ?? "PUT";
  const requestTarget = `${method.toUpperCase()} ${sanitizeUrlForLogging(upload.uploadUrl)}`;
  const headers = new Headers(
    upload.headers ?? { "content-type": artifact.contentType },
  );
  if (shouldAttachHubAuthorization(upload.uploadUrl, hubAuth)) {
    headers.set("authorization", `Bearer ${hubAuth.token}`);
  }
  const response = await fetchImpl(upload.uploadUrl, {
    method,
    headers,
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Hub artifact upload failed for ${artifact.path}: ${requestTarget} -> HTTP ${response.status}`,
    );
  }

  return {
    ...artifact,
    storage: "minio",
    objectRef: upload.objectRef,
    uploadSessionId,
  };
}

function shouldAttachHubAuthorization(
  uploadUrl: string,
  hubAuth: HubUploadAuth | undefined,
): hubAuth is HubUploadAuth & { token: string } {
  if (!hubAuth?.token) return false;
  try {
    const target = new URL(uploadUrl);
    const hub = new URL(hubAuth.apiBaseUrl);
    if (target.origin !== hub.origin) return false;
    const basePath = hub.pathname.replace(/\/+$/, "");
    return (
      !basePath ||
      target.pathname === basePath ||
      target.pathname.startsWith(`${basePath}/`)
    );
  } catch {
    return false;
  }
}

export async function downloadFromSignedUrl(
  url: string,
  expectedSha256: string,
  fetchImpl: FetchLike,
): Promise<Buffer> {
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`MinIO download failed: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = hashBuffer(buffer);
  if (actual !== expectedSha256) {
    throw new Error(
      `Downloaded document sha256 mismatch: expected ${expectedSha256}, got ${actual}`,
    );
  }
  return buffer;
}

export function writeDownloadedDocument(filePath: string, body: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}
