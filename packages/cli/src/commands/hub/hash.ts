import { createHash } from "node:crypto";
import fs from "node:fs";

import type { HubArtifact } from "./types.js";

export function hashText(content: string): string {
  return createHash("sha256")
    .update(normalizeText(content), "utf-8")
    .digest("hex");
}

export function hashBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeText(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function readNormalizedTextFile(filePath: string): string {
  return normalizeText(fs.readFileSync(filePath, "utf-8"));
}

export function hashArtifactBundle(artifacts: readonly HubArtifact[]): string {
  const payload = artifacts
    .map((artifact) => ({
      path: artifact.path,
      type: artifact.type,
      sha256: artifact.sha256,
      size: artifact.size,
      contentType: artifact.contentType,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return hashText(JSON.stringify(payload));
}

export function textFileSize(content: string): number {
  return Buffer.byteLength(normalizeText(content), "utf-8");
}
