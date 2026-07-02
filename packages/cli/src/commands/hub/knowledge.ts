import { requestAgentHubJson } from "./agent-hub-client.js";
import { resolveHubConfig } from "./config.js";
import type { FetchLike, HubCommandResult } from "./types.js";

const DEFAULT_TOP_K = 3;
const MIN_TOP_K = 1;
const MAX_TOP_K = 20;

export interface HubKnowledgeSearchOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fetch?: FetchLike;
  query: string | readonly string[];
  topK?: number | string;
}

export interface HubKnowledgeArtifact {
  artifact?: Record<string, unknown>;
  score?: number;
  snippet?: string;
}

interface VectorSearchResponse {
  artifacts?: HubKnowledgeArtifact[];
  count?: number;
}

export interface HubKnowledgeSearchResult {
  query: string;
  results: HubKnowledgeSearchResultItem[];
}

export interface HubKnowledgeSearchResultItem {
  title?: string;
  module?: string;
  endpointPath?: string;
  snippet?: string;
}

export async function hubKnowledgeSearch(
  options: HubKnowledgeSearchOptions,
): Promise<HubKnowledgeSearchResult | HubCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const query = normalizeKnowledgeQuery(options.query);
  const topK = normalizeTopK(options.topK);
  const config = resolveHubConfig({
    cwd,
    env: options.env,
    homeDir: options.homeDir,
    requireAuth: true,
  });
  if (!config.enabled) {
    return { status: "disabled", message: config.reason };
  }

  const response = await requestAgentHubJson<VectorSearchResponse>(
    config,
    "POST",
    `/projects/${encodeURIComponent(config.projectId)}/knowledge/vector-search`,
    { query, top_k: topK },
    options.fetch ?? fetch,
    "knowledge",
  );

  return {
    query,
    results: (response.artifacts ?? [])
      .map(compactKnowledgeArtifact)
      .filter(hasKnowledgeResultContent),
  };
}

function compactKnowledgeArtifact(
  result: HubKnowledgeArtifact,
): HubKnowledgeSearchResultItem {
  const artifact = result.artifact ?? {};
  const item: HubKnowledgeSearchResultItem = {};
  const title = stringField(artifact.title);
  const moduleName = stringField(artifact.module);
  const endpointPath = stringField(artifact.endpoint_path);
  const snippet = stringField(result.snippet);

  if (title) item.title = title;
  if (moduleName) item.module = moduleName;
  if (endpointPath) item.endpointPath = endpointPath;
  if (snippet) item.snippet = snippet;

  return item;
}

function hasKnowledgeResultContent(
  result: HubKnowledgeSearchResultItem,
): boolean {
  return Boolean(
    result.title ?? result.module ?? result.endpointPath ?? result.snippet,
  );
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeKnowledgeQuery(query: string | readonly string[]): string {
  const value = typeof query === "string" ? query : query.join(" ");
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Knowledge query is required.");
  }
  return normalized;
}

function normalizeTopK(value: number | string | undefined): number {
  if (value === undefined) return DEFAULT_TOP_K;
  const topK =
    typeof value === "number"
      ? value
      : Number.parseInt(value.trim(), 10);
  if (
    !Number.isInteger(topK) ||
    topK < MIN_TOP_K ||
    topK > MAX_TOP_K ||
    (typeof value === "string" && String(topK) !== value.trim())
  ) {
    throw new Error("Knowledge top_k must be an integer between 1 and 20.");
  }
  return topK;
}
