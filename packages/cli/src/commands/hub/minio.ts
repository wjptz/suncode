import fs from "node:fs";
import path from "node:path";

import { hashBuffer, readNormalizedTextFile } from "./hash.js";
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

export async function uploadArtifactToMinio(
  artifact: HubArtifact,
  upload: UploadTarget,
  uploadSessionId: string,
  fetchImpl: FetchLike,
): Promise<UploadedArtifact> {
  const body = Buffer.from(readNormalizedTextFile(artifact.absolutePath), "utf-8");
  const response = await fetchImpl(upload.uploadUrl, {
    method: upload.method ?? "PUT",
    headers: upload.headers ?? { "content-type": artifact.contentType },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `MinIO upload failed for ${artifact.path}: HTTP ${response.status}`,
    );
  }

  return {
    ...artifact,
    storage: "minio",
    objectRef: upload.objectRef,
    uploadSessionId,
  };
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
