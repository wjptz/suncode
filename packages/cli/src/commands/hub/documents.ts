import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import { createHubApiClient } from "./client.js";
import { resolveHubConfig } from "./config.js";
import { downloadFromSignedUrl, writeDownloadedDocument } from "./minio.js";
import { readHubTask } from "./task.js";
import type { FetchLike, ObjectRef } from "./types.js";

export type HubTextOrDocumentPayload =
  | { kind: "text"; text: string; document: null }
  | {
      kind: "document";
      text: null;
      document: {
        documentId: string;
        filename: string;
        contentType?: string;
        sha256: string;
        size?: number;
        objectRef?: ObjectRef;
      };
    };

export type DownloadPayloadResult =
  | { kind: "text"; text: string }
  | { kind: "document"; localPath: string; sha256: string; size: number };

interface DownloadUrlResponse {
  document: {
    documentId: string;
    filename: string;
    contentType?: string;
    sha256: string;
    size?: number;
  };
  download: {
    url: string;
    method?: "GET";
    expiresAt?: string;
  };
}

export interface DownloadDocumentPayloadOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  payload: HubTextOrDocumentPayload;
  targetDir: string;
  fetch?: FetchLike;
}

export interface DownloadHubDocumentOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  payloadJsonPath?: string;
  documentId?: string;
  filename?: string;
  contentType?: string;
  sha256?: string;
  size?: number;
  targetDir?: string;
  taskJsonPath?: string;
  fetch?: FetchLike;
}

export async function downloadHubDocument(
  options: DownloadHubDocumentOptions,
): Promise<DownloadPayloadResult> {
  const cwd = options.cwd ?? process.cwd();
  const payload = options.payloadJsonPath
    ? readPayloadJson(cwd, options.payloadJsonPath)
    : documentPayloadFromOptions(options);
  const targetDir = resolveDownloadTargetDir(cwd, payload, options);

  return downloadDocumentPayload({
    cwd,
    env: options.env,
    payload,
    targetDir,
    fetch: options.fetch,
  });
}

export async function downloadDocumentPayload(
  options: DownloadDocumentPayloadOptions,
): Promise<DownloadPayloadResult> {
  if (options.payload.kind === "text") {
    return { kind: "text", text: options.payload.text };
  }

  const cwd = options.cwd ?? process.cwd();
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    requireAuth: true,
  });
  if (!config.enabled) {
    throw new Error("Hub is disabled; cannot download document payload.");
  }

  const document = options.payload.document;
  const client = createHubApiClient(config, options.fetch);
  const response = await client.requestJson<DownloadUrlResponse>(
    "GET",
    `/projects/${encodeURIComponent(config.projectId)}/documents/${encodeURIComponent(document.documentId)}/download-url`,
  );
  const expectedSha256 = response.document.sha256 || document.sha256;
  if (!expectedSha256) {
    throw new Error(
      `Hub document ${document.documentId} download response did not include sha256.`,
    );
  }
  const body = await downloadFromSignedUrl(
    response.download.url,
    expectedSha256,
    options.fetch ?? fetch,
  );
  const localPath = path.join(
    options.targetDir,
    "hub-sources",
    sanitizeFilename(response.document.filename || document.filename),
  );
  writeDownloadedDocument(localPath, body);

  return {
    kind: "document",
    localPath,
    sha256: expectedSha256,
    size: body.byteLength,
  };
}

function readPayloadJson(
  cwd: string,
  payloadJsonPath: string,
): HubTextOrDocumentPayload {
  const resolved = path.resolve(cwd, payloadJsonPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf-8")) as unknown;
  const candidate =
    parsed && typeof parsed === "object" && "payload" in parsed
      ? (parsed as { payload: unknown }).payload
      : parsed;
  return parsePayload(candidate);
}

function documentPayloadFromOptions(
  options: DownloadHubDocumentOptions,
): HubTextOrDocumentPayload {
  if (!options.documentId) {
    throw new Error("Pass --payload-json or --document-id.");
  }
  return {
    kind: "document",
    text: null,
    document: {
      documentId: options.documentId,
      filename: options.filename ?? `${options.documentId}.md`,
      contentType: options.contentType,
      sha256: options.sha256 ?? "",
      size: options.size,
    },
  };
}

function resolveDownloadTargetDir(
  cwd: string,
  payload: HubTextOrDocumentPayload,
  options: DownloadHubDocumentOptions,
): string {
  if (options.targetDir) return path.resolve(cwd, options.targetDir);
  if (options.taskJsonPath) {
    return readHubTask(options.taskJsonPath, cwd).taskDir;
  }
  if (payload.kind === "document") {
    return path.join(
      cwd,
      DIR_NAMES.WORKFLOW,
      "hub-inbox",
      sanitizeFilename(payload.document.documentId),
    );
  }
  return path.join(cwd, DIR_NAMES.WORKFLOW, "hub-inbox");
}

function parsePayload(value: unknown): HubTextOrDocumentPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Payload JSON must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "text") {
    if (typeof record.text !== "string") {
      throw new Error("Text payload must include a text string.");
    }
    return { kind: "text", text: record.text, document: null };
  }
  if (record.kind !== "document") {
    throw new Error("Payload kind must be text or document.");
  }
  const document = record.document;
  if (!document || typeof document !== "object") {
    throw new Error("Document payload must include a document object.");
  }
  const documentRecord = document as Record<string, unknown>;
  const documentId = stringField(documentRecord, "documentId");
  if (!documentId) {
    throw new Error("Document payload must include document.documentId.");
  }
  return {
    kind: "document",
    text: null,
    document: {
      documentId,
      filename: stringField(documentRecord, "filename") ?? `${documentId}.md`,
      contentType: stringField(documentRecord, "contentType"),
      sha256: stringField(documentRecord, "sha256") ?? "",
      size:
        typeof documentRecord.size === "number"
          ? documentRecord.size
          : undefined,
      objectRef:
        documentRecord.objectRef && typeof documentRecord.objectRef === "object"
          ? (documentRecord.objectRef as ObjectRef)
          : undefined,
    },
  };
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w.-]+/g, "-");
  return base || "document";
}
