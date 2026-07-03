import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HubConfigError,
  parseHubSection,
  resolveHubConfig,
} from "../../src/commands/hub/config.js";
import { hubInit } from "../../src/commands/hub/init.js";
import { hubIntake } from "../../src/commands/hub/intake.js";
import { hubKnowledgeSearch } from "../../src/commands/hub/knowledge.js";
import { hubLogin, hubLogout } from "../../src/commands/hub/login.js";
import { pullLatestReview } from "../../src/commands/hub/pull.js";
import { hubSkillPull, hubSkillPush } from "../../src/commands/hub/skills.js";
import {
  formatHubStatePrompt,
  hubState,
  type HubStateResult,
} from "../../src/commands/hub/state.js";
import {
  discardSpecDeletion,
  keepSpecDeletion,
  listSpecDeletions,
  pullHubSpecs,
} from "../../src/commands/hub/specs.js";
import {
  collectPlanArtifacts,
  collectCompletionArtifacts,
  collectReviewArtifacts,
  collectSpecArtifacts,
} from "../../src/commands/hub/artifacts.js";
import { hubCreateTask } from "../../src/commands/hub/create-task.js";
import {
  downloadDocumentPayload,
  downloadHubDocument,
} from "../../src/commands/hub/documents.js";
import { hashText } from "../../src/commands/hub/hash.js";
import { registerHubCommand } from "../../src/commands/hub/index.js";
import {
  loadHubManifest,
  loadProjectSpecManifest,
} from "../../src/commands/hub/manifest.js";
import {
  submitPlan,
  submitCompletion,
  submitSpec,
  submitSubtasks,
} from "../../src/commands/hub/submissions.js";
import { syncPending } from "../../src/commands/hub/sync-queue.js";
import { hubFinish, hubPlanReady } from "../../src/commands/hub/workflow.js";
import { hubReview } from "../../src/commands/hub/review.js";
import {
  HubTaskError,
  resolveTaskJsonPath,
} from "../../src/commands/hub/task.js";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function writeProjectConfig(tmpDir: string, content: string): void {
  fs.mkdirSync(path.join(tmpDir, ".suncode"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".suncode", "config.yaml"), content);
}

function writeGlobalHubConfig(
  homeDir: string,
  defaultApiBaseUrl: string,
): void {
  const filePath = path.join(homeDir, ".suncode", "hub", "config.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ version: 1, defaultApiBaseUrl }, null, 2)}\n`,
    "utf-8",
  );
}

function writeHubAuth(
  homeDir: string,
  apiBaseUrl = "https://hub.example.test",
  token = "login-token",
): void {
  const filePath = path.join(homeDir, ".suncode", "hub", "auth.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        sessions: {
          [apiBaseUrl]: {
            developerId: "dev_456",
            displayName: "kangmeng",
            token,
            expiresAt: "2099-01-01T00:00:00.000Z",
            loggedInAt: "2026-07-01T12:00:00.000Z",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function writeHubSpecManifest(
  tmpDir: string,
  data: Record<string, unknown>,
): void {
  writeJson(path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"), data);
}

function writeSpecDeletionManifest(
  tmpDir: string,
  revision: string,
  data: Record<string, unknown>,
): void {
  writeJson(
    path.join(
      tmpDir,
      ".suncode",
      ".runtime",
      "hub-spec-deletions",
      revision,
      "manifest.json",
    ),
    data,
  );
}

function makeTask(tmpDir: string, dirName = "06-30-payment-retry"): string {
  const taskDir = path.join(tmpDir, ".suncode", "tasks", dirName);
  writeJson(path.join(taskDir, "task.json"), {
    id: "payment-retry",
    name: "payment-retry",
    title: "Add payment retry",
    description: "Retry failed payment automatically.",
    status: "planning",
    package: null,
    priority: "P1",
    creator: "dev_456",
    assignee: "dev_456",
    createdAt: "2026-06-30",
    completedAt: null,
    branch: null,
    base_branch: "main",
    worktree_path: null,
    commit: null,
    pr_url: null,
    subtasks: [],
    children: [],
    parent: null,
    relatedFiles: [],
    notes: "",
    meta: {
      hub: {
        projectId: "proj_123",
        developerId: "dev_456",
        requirementId: "REQ-1001",
        requirementRevision: 7,
        taskRole: "single",
        bindingStatus: "pending",
      },
    },
  });
  fs.writeFileSync(path.join(taskDir, "prd.md"), "# PRD\n", "utf-8");
  return path.join(taskDir, "task.json");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "content-type": "text/markdown" },
  });
}

function createMockFetch(): {
  calls: FetchCall[];
  fetch: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body === undefined
          ? undefined
          : String(init.body);
    calls.push({ url: String(url), method, headers, body });

    if (method === "PUT") {
      return new Response(null, { status: 200 });
    }

    if (String(url).endsWith("/artifact-upload-sessions")) {
      const payload = JSON.parse(body ?? "{}") as {
        artifacts?: { path: string; contentType: string }[];
      };
      return jsonResponse({
        uploadSession: {
          id: "UPLOAD-9001",
          expiresAt: "2026-06-30T12:15:00Z",
          artifactBundleHash: payload,
        },
        uploads: (payload.artifacts ?? []).map((artifact) => ({
          path: artifact.path,
          uploadUrl: `https://hub.example.test/api/v1/projects/proj_123/artifact-upload-sessions/UPLOAD-9001/uploads/${artifact.path}`,
          method: "PUT",
          headers: { "Content-Type": artifact.contentType },
          objectRef: {
            provider: "minio",
            objectKey: `objects/${artifact.path}`,
            versionId: null,
          },
          expiresAt: "2026-06-30T12:15:00Z",
        })),
      });
    }

    if (
      String(url).endsWith("/plan-submissions") ||
      String(url).endsWith("/spec-submissions") ||
      String(url).endsWith("/completion-submissions") ||
      String(url).endsWith("/review-submissions")
    ) {
      return jsonResponse({
        submission: {
          id: String(url).endsWith("/spec-submissions")
            ? "SPEC-4001"
            : String(url).endsWith("/review-submissions")
              ? "REVIEW-6001"
              : "PLAN-3001",
          remoteRevision: 4,
          reviewStatus: "pending",
          createdAt: "2026-06-30T12:00:00Z",
        },
        artifacts: (JSON.parse(body ?? "{}").artifacts ?? []).map(
          (artifact: { path: string; sha256: string; objectRef: unknown }) => ({
            path: artifact.path,
            remoteArtifactId: `ART-${artifact.path}`,
            remoteRevision: 1,
            sha256: artifact.sha256,
            storage: "minio",
            objectRef: artifact.objectRef,
          }),
        ),
      });
    }

    if (method === "PATCH" && String(url).endsWith("/status")) {
      return jsonResponse({
        task: {
          status: (JSON.parse(body ?? "{}") as { status?: string }).status,
        },
      });
    }

    if (method === "POST" && String(url).endsWith("/preflight-start")) {
      return jsonResponse({
        preflight: {
          status: "ok",
          policy: "confirm",
        },
      });
    }

    if (String(url).endsWith("/subtasks")) {
      return jsonResponse({
        submission: {
          id: "SUBTASKS-5001",
          remoteRevision: 2,
          createdAt: "2026-06-30T12:00:00Z",
        },
        subtasks: (JSON.parse(body ?? "{}").subtasks ?? []).map(
          (subtask: { name: string }, index: number) => ({
            remoteSubtaskId: `SUBTASK-${index + 1}`,
            name: subtask.name,
          }),
        ),
      });
    }

    if (String(url).includes("/requirements/REQ-1001/tasks")) {
      return jsonResponse({
        task: {
          id: "TASK-2001",
          projectId: "proj_123",
          requirementId: "REQ-1001",
          localTaskId: "06-30-payment-retry",
          taskRole: "single",
          parentTaskId: null,
          status: "planning",
          createdAt: "2026-06-30T12:00:00Z",
        },
      });
    }

    if (method === "GET" && String(url).includes("/requirements?")) {
      return jsonResponse({
        requirements: [
          {
            id: "REQ-1001",
            title: "登录状态识别",
            description: "识别用户登录状态。",
            revision: 7,
            status: "ready",
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch call: ${method} ${String(url)}`);
  });
  return { calls, fetch };
}

describe("hub config", () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
    homeDir = path.join(tmpDir, "home");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses only the active hub section and strips inline comments", () => {
    const config = parseHubSection(`
# hub:
#   enabled: true
hub:
  enabled: true # team mode
  mode: team
  projectId: "proj_123"
  developerId: 'dev_456'
  apiBaseUrl: "https://hub.example.test"
  startReviewPolicy: confirm
`);

    expect(config).toEqual({
      enabled: true,
      mode: "team",
      projectId: "proj_123",
      developerId: "dev_456",
      apiBaseUrl: "https://hub.example.test",
      startReviewPolicy: "confirm",
    });
  });

  it("parses nested hub review configuration with provider defaults", () => {
    const config = parseHubSection(`
hub:
  enabled: true
  mode: team
  projectId: proj_123
  apiBaseUrl: https://hub.example.test
  review:
    enabled: true
    provider: engineer
    required: true
    trigger: manual
    unavailablePolicy: block
    engineer:
      command: engineer
      args: ["run", "--no-write"]
      timeoutSeconds: 1200
      saveRawOutput: false
`);

    expect(config).toMatchObject({
      review: {
        enabled: true,
        provider: "engineer",
        required: true,
        trigger: "manual",
        unavailablePolicy: "block",
        engineer: {
          command: "engineer",
          args: ["run", "--no-write"],
          timeoutSeconds: 1200,
          saveRawOutput: false,
        },
      },
    });
  });

  it("does not require SUNCODE_HUB_TOKEN while hub is disabled", () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: false\n");

    const config = resolveHubConfig({ cwd: tmpDir, env: {}, requireAuth: true });

    expect(config.enabled).toBe(false);
  });

  it("uses global apiBaseUrl and login session, ignoring SUNCODE_HUB_TOKEN", () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    writeGlobalHubConfig(homeDir, "https://hub.example.test/");
    writeHubAuth(homeDir, "https://hub.example.test", "login-token");

    const config = resolveHubConfig({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "env-token" },
      requireAuth: true,
    });

    expect(config.enabled).toBe(true);
    if (!config.enabled) return;
    expect(config.apiBaseUrl).toBe("https://hub.example.test");
    expect(config.apiBaseUrlSource).toBe("global");
    expect(config.token).toBe("login-token");
  });

  it("resolves hub review defaults without making review required by default", () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  projectId: proj_123",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    writeHubAuth(homeDir);

    const config = resolveHubConfig({
      cwd: tmpDir,
      homeDir,
      env: {},
      requireAuth: true,
    });

    expect(config).toMatchObject({
      enabled: true,
      review: {
        enabled: true,
        provider: "engineer",
        required: false,
        trigger: "manual",
        unavailablePolicy: "bypass",
        engineer: {
          command: "engineer",
          args: ["run"],
          timeoutSeconds: 900,
          saveRawOutput: true,
        },
      },
    });
  });

  it("fails fast when enabled config has no project or resolved apiBaseUrl", () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n");

    expect(() =>
      resolveHubConfig({
        cwd: tmpDir,
        homeDir,
        env: { SUNCODE_HUB_TOKEN: "jwt" },
        requireAuth: true,
      }),
    ).toThrow(HubConfigError);

    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    expect(() =>
      resolveHubConfig({ cwd: tmpDir, homeDir, env: {}, requireAuth: true }),
    ).toThrow("Hub apiBaseUrl is required");
  });
});

describe("hub init login logout state", () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
    homeDir = path.join(tmpDir, "home");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init writes global default apiBaseUrl and project Hub config without secrets", async () => {
    writeProjectConfig(tmpDir, "session_commit_message: keep me\n");

    const result = await hubInit({
      cwd: tmpDir,
      homeDir,
      apiBaseUrl: "https://hub.example.test/",
      projectId: "proj_123",
      developerId: "dev_456",
      yes: true,
    });

    expect(result.status).toBe("updated");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(homeDir, ".suncode", "hub", "config.json"),
          "utf-8",
        ),
      ),
    ).toEqual({
      version: 1,
      defaultApiBaseUrl: "https://hub.example.test",
    });
    const projectConfig = fs.readFileSync(
      path.join(tmpDir, ".suncode", "config.yaml"),
      "utf-8",
    );
    expect(projectConfig).toContain("session_commit_message: keep me");
    expect(projectConfig).toContain("projectId: proj_123");
    expect(projectConfig).not.toContain("token");
  });

  it("login stores a session by apiBaseUrl and logout removes only that session", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    writeGlobalHubConfig(homeDir, "https://hub.example.test");
    const fetch = vi.fn(async () =>
      jsonResponse({
        token: "login-token",
        user: {
          id: 1,
          email: "admin@example.com",
          display_name: "Admin",
          role: "admin",
          created_at: "2026-06-29T12:18:41.892335+08:00",
          updated_at: "2026-06-29T12:18:41.892335+08:00",
        },
      }),
    );

    const login = await hubLogin({
      cwd: tmpDir,
      homeDir,
      email: "admin@example.com",
      password: "secret",
      fetch,
    });

    expect(login.status).toBe("updated");
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = fetch.mock.calls[0];
    expect(String(call[0])).toBe("https://hub.example.test/api/auth/login");
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      email: "admin@example.com",
      password: "secret",
    });

    const authPath = path.join(homeDir, ".suncode", "hub", "auth.json");
    const auth = JSON.parse(fs.readFileSync(authPath, "utf-8")) as {
      sessions: Record<string, { developerId: string; displayName?: string }>;
    };
    expect(auth.sessions["https://hub.example.test"]).toMatchObject({
      developerId: "1",
      displayName: "Admin",
    });

    const logout = hubLogout({ cwd: tmpDir, homeDir });

    expect(logout.status).toBe("updated");
    expect(fs.readFileSync(authPath, "utf-8")).not.toContain("login-token");
  });

  it("state reports hub off without network and writes a project cache", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: false\n");
    const fetch = vi.fn();

    const result = await hubState({ cwd: tmpDir, homeDir, fetch });

    expect(result.summary.hub).toBe("off");
    expect(fetch).not.toHaveBeenCalled();
    const cache = fs.readFileSync(
      path.join(tmpDir, ".suncode", ".runtime", "hub-state.json"),
      "utf-8",
    );
    expect(cache).toContain('"hub": "off"');
  });

  it("state includes the pending Hub sync queue count", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: false\n");
    const runtimeDir = path.join(tmpDir, ".suncode", ".runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, "hub-sync-queue.jsonl"),
      [
        JSON.stringify({
          taskJsonPath: "/tmp/task-1.json",
          event: "after_start",
          command: "suncode hub mark-started",
          error: "failed",
          attempt: 1,
          firstFailedAt: "2026-07-03T00:00:00.000Z",
          lastFailedAt: "2026-07-03T00:00:00.000Z",
          nextRetryAt: "2026-07-03T00:00:00.000Z",
        }),
        JSON.stringify({
          taskJsonPath: "/tmp/task-2.json",
          event: "after_archive",
          command: "suncode hub submit-completion",
          error: "failed",
          attempt: 1,
          firstFailedAt: "2026-07-03T00:00:00.000Z",
          lastFailedAt: "2026-07-03T00:00:00.000Z",
          nextRetryAt: "2026-07-03T00:00:00.000Z",
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await hubState({ cwd: tmpDir, homeDir });

    expect(result.sync?.pendingSyncCount).toBe(2);
  });

  it("state reports missing login before service probing", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    writeGlobalHubConfig(homeDir, "https://hub.example.test");
    const fetch = vi.fn();

    const result = await hubState({ cwd: tmpDir, homeDir, fetch });

    expect(result.summary).toMatchObject({
      hub: "on",
      config: "ok",
      login: "missing",
      service: "skipped",
      work: "skipped",
    });
    expect(result.nextAction).toContain("suncode hub login");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("state checks service/work and marks an active ordinary task as local-only", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    writeGlobalHubConfig(homeDir, "https://hub.example.test");
    writeHubAuth(homeDir);
    const taskDir = path.join(tmpDir, ".suncode", "tasks", "07-01-local-work");
    writeJson(path.join(taskDir, "task.json"), {
      id: "local-work",
      status: "in_progress",
      meta: {},
    });
    writeJson(
      path.join(
        tmpDir,
        ".suncode",
        ".runtime",
        "sessions",
        "session-a.json",
      ),
      { current_task: ".suncode/tasks/07-01-local-work" },
    );
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/health")) {
        return jsonResponse({ status: "ok", version: "1.2.3", name: "Hub" });
      }
      if (String(url).includes("/requirements?")) {
        return jsonResponse({
          requirements: [
            { id: "REQ-1001", title: "Do team work", status: "ready" },
          ],
        });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    const result = await hubState({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_CONTEXT_ID: "session-a" },
      fetch,
    });

    expect(result.summary).toMatchObject({
      hub: "on",
      config: "ok",
      login: "ok",
      service: "ok",
      work: "available",
      currentTask: "local-only",
    });
    expect(result.nextAction).toContain("不要执行 Hub 任务提交命令");
    const cache = fs.readFileSync(
      path.join(tmpDir, ".suncode", ".runtime", "hub-state.json"),
      "utf-8",
    );
    expect(cache).not.toContain("login-token");
    expect(cache).toContain('"currentTask": "local-only"');
  });

  it("state omits Hub spec sync summary and does not fetch service-side specs", async () => {
    writeProjectConfig(tmpDir, "hub:\n  enabled: true\n  projectId: proj_123\n");
    writeGlobalHubConfig(homeDir, "https://hub.example.test");
    writeHubAuth(homeDir);
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "local"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".suncode", "spec", "local", "debugging.md"),
      "# Local only\n",
      "utf-8",
    );
    writeHubSpecManifest(tmpDir, {
      version: 1,
      projectId: "proj_123",
      apiBaseUrl: "https://hub.example.test",
      policy: "remote_wins",
      revision: "spec-rev-42",
      bundleHash: "sha256:bundle",
      syncedAt: "2026-07-01T12:00:00.000Z",
      files: {},
    });
    writeSpecDeletionManifest(tmpDir, "spec-rev-42", {
      version: 1,
      revision: "spec-rev-42",
      deletedAt: "2026-07-01T12:00:00.000Z",
      items: [
        {
          id: "del_001",
          previousPath: ".suncode/spec/cli/backend/old.md",
          backupPath:
            ".suncode/.runtime/hub-spec-deletions/spec-rev-42/cli/backend/old.md",
          previousSha256: "old-sha",
          reason: "remote deleted this Hub-managed spec",
          status: "pending",
        },
      ],
    });
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/health")) return jsonResponse({ status: "ok" });
      if (String(url).includes("/requirements?")) {
        return jsonResponse({ requirements: [] });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    const result = await hubState({ cwd: tmpDir, homeDir, fetch });

    expect((result as Record<string, unknown>).spec).toBeUndefined();
    const cache = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-state.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(cache.spec).toBeUndefined();
    expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://hub.example.test/api/v1/health",
      "https://hub.example.test/api/v1/projects/proj_123/requirements?developerId=dev_456&status=ready%2Cin_review%2Cchanges_requested",
    ]);
  });
});

describe("hub artifacts and hashing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("normalizes CRLF before hashing", () => {
    expect(hashText("a\r\nb\r\n")).toBe(hashText("a\nb\n"));
  });

  it("collects plan artifacts only from the target task", () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(path.join(taskDir, "implement.md"), "# Impl\n", "utf-8");
    fs.mkdirSync(path.join(taskDir, "research"), { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, "research", "notes.md"),
      "# Notes\n",
      "utf-8",
    );

    const siblingDir = path.join(
      tmpDir,
      ".suncode",
      "tasks",
      "06-30-unrelated",
    );
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, "design.md"), "# Wrong\n", "utf-8");

    const artifacts = collectPlanArtifacts({ cwd: tmpDir, taskJsonPath });

    expect(artifacts.map((artifact) => artifact.path).sort()).toEqual([
      "design.md",
      "implement.md",
      "prd.md",
      "research/notes.md",
    ]);
    expect(
      artifacts.some((artifact) => artifact.absolutePath.includes("unrelated")),
    ).toBe(false);
  });

  it("collects completion artifacts only from explicit completion files", () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(
      path.join(taskDir, "implementation-summary.md"),
      "# Done\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(taskDir, "prd.md"), "# Not completion\n");

    const artifacts = collectCompletionArtifacts({ cwd: tmpDir, taskJsonPath });

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "implementation-summary.md",
    ]);
  });

  it("collects review round artifacts as current-task review artifacts", () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const roundDir = path.join(taskDir, "reviews", "round-001");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, "review.json"), "{}\n", "utf-8");
    fs.writeFileSync(path.join(roundDir, "result.md"), "# Result\n", "utf-8");
    fs.writeFileSync(
      path.join(roundDir, "raw-output.md"),
      "raw provider output\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(roundDir, "diff.patch"), "diff --git\n", "utf-8");
    fs.writeFileSync(path.join(roundDir, "prompt.md"), "# Prompt\n", "utf-8");
    fs.mkdirSync(path.join(taskDir, "reviews", "round-002"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(taskDir, "reviews", "round-002", "review.json"),
      "{}\n",
      "utf-8",
    );

    const artifacts = collectReviewArtifacts({
      cwd: tmpDir,
      taskJsonPath,
      round: 1,
    });

    expect(artifacts.map((artifact) => [artifact.path, artifact.type])).toEqual([
      ["reviews/round-001/diff.patch", "review"],
      ["reviews/round-001/prompt.md", "review"],
      ["reviews/round-001/raw-output.md", "review"],
      ["reviews/round-001/result.md", "review"],
      ["reviews/round-001/review.json", "review"],
    ]);
  });

  it("collects project spec artifacts while ignoring task documents", () => {
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "cli"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".suncode", "spec", "cli", "contract.md"),
      "# Contract\n",
    );
    const taskJsonPath = makeTask(tmpDir);
    const siblingDir = path.join(
      tmpDir,
      ".suncode",
      "tasks",
      "06-30-unrelated",
    );
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, "prd.md"), "# Wrong PRD\n");

    expect(collectSpecArtifacts(tmpDir).map((artifact) => artifact.path)).toEqual(
      [".suncode/spec/cli/contract.md"],
    );
    expect(
      collectSpecArtifacts(tmpDir, [".suncode/spec/cli/contract.md"]).map(
        (artifact) => artifact.path,
      ),
    ).toEqual([".suncode/spec/cli/contract.md"]);
    expect(collectPlanArtifacts({ cwd: tmpDir, taskJsonPath }).map((a) => a.path)).toEqual([
      "prd.md",
    ]);
  });
});

describe("hub spec sync", () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
    homeDir = path.join(tmpDir, "home");
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "",
      ].join("\n"),
    );
    writeHubAuth(homeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pull-spec applies remote-wins, preserves deleted managed specs, and keeps local-only files", async () => {
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "cli", "backend"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "local"), {
      recursive: true,
    });
    const stalePath = path.join(
      tmpDir,
      ".suncode",
      "spec",
      "cli",
      "backend",
      "index.md",
    );
    const deletedPath = path.join(
      tmpDir,
      ".suncode",
      "spec",
      "cli",
      "backend",
      "old-rule.md",
    );
    fs.writeFileSync(stalePath, "# Local stale\n", "utf-8");
    fs.writeFileSync(deletedPath, "# Deleted but useful\n", "utf-8");
    fs.writeFileSync(
      path.join(tmpDir, ".suncode", "spec", "local", "debugging.md"),
      "# Local only\n",
      "utf-8",
    );
    writeHubSpecManifest(tmpDir, {
      version: 1,
      projectId: "proj_123",
      apiBaseUrl: "https://hub.example.test",
      policy: "remote_wins",
      revision: "spec-rev-41",
      files: {
        ".suncode/spec/cli/backend/index.md": {
          sha256: hashText("# Local stale\n"),
          managedBy: "hub",
        },
        ".suncode/spec/cli/backend/old-rule.md": {
          sha256: hashText("# Deleted but useful\n"),
          managedBy: "hub",
        },
      },
    });
    const remoteIndex = "# Remote index\n";
    const remoteNew = "# New rule\n";
    const fetch = vi.fn(async (url: unknown) => {
      const urlText = String(url);
      if (urlText === "https://minio.example.test/download/index") {
        return textResponse(remoteIndex);
      }
      if (urlText === "https://minio.example.test/download/new") {
        return textResponse(remoteNew);
      }
      expect(urlText).toBe(
        "https://hub.example.test/api/v1/projects/proj_123/specs/bundle",
      );
      return jsonResponse({
        revision: "spec-rev-42",
        etag: '"spec-rev-42"',
        bundleHash: "sha256:bundle",
        basePath: ".suncode/spec",
        files: [
          {
            path: "cli/backend/index.md",
            sha256: hashText(remoteIndex),
            size: Buffer.byteLength(remoteIndex),
            contentType: "text/markdown",
            download: {
              url: "https://minio.example.test/download/index",
              method: "GET",
              expiresAt: "2026-07-01T12:10:00+08:00",
            },
            objectRef: {
              provider: "minio",
              bucket: "suncode-hub",
              objectKey: "specs/proj_123/spec-rev-42/index.md",
            },
            language: "zh-CN",
            updatedAt: "2026-07-01T12:00:00+08:00",
          },
          {
            path: "cli/backend/new-rule.md",
            sha256: hashText(remoteNew),
            size: Buffer.byteLength(remoteNew),
            contentType: "text/markdown",
            download: {
              url: "https://minio.example.test/download/new",
              method: "GET",
              expiresAt: "2026-07-01T12:10:00+08:00",
            },
            objectRef: {
              provider: "minio",
              bucket: "suncode-hub",
              objectKey: "specs/proj_123/spec-rev-42/new-rule.md",
            },
            language: "zh-CN",
            updatedAt: "2026-07-01T12:00:00+08:00",
          },
        ],
        deleted: ["cli/backend/old-rule.md"],
      });
    });

    const result = await pullHubSpecs({ cwd: tmpDir, homeDir, fetch });

    expect(result).toMatchObject({
      status: "updated",
      policy: "remote_wins",
      revision: "spec-rev-42",
      bundleHash: "sha256:bundle",
    });
    expect(result.actions.added).toEqual([
      ".suncode/spec/cli/backend/new-rule.md",
    ]);
    expect(result.actions.updated).toEqual([
      ".suncode/spec/cli/backend/index.md",
    ]);
    expect(result.actions.deleted).toEqual([
      ".suncode/spec/cli/backend/old-rule.md",
    ]);
    expect(result.localOnly).toEqual([
      ".suncode/spec/local/debugging.md",
    ]);
    expect(result.deletionCandidates).toHaveLength(1);
    expect(fs.readFileSync(stalePath, "utf-8")).toBe(remoteIndex);
    expect(fs.existsSync(deletedPath)).toBe(false);
    expect(
      fs.readFileSync(
        path.join(tmpDir, ".suncode", "spec", "cli", "backend", "new-rule.md"),
        "utf-8",
      ),
    ).toBe(remoteNew);
    const candidate = result.deletionCandidates[0];
    expect(
      fs.readFileSync(path.join(tmpDir, candidate.backupPath), "utf-8"),
    ).toBe("# Deleted but useful\n");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"),
        "utf-8",
      ),
    );
    expect(manifest.files).toEqual({
      ".suncode/spec/cli/backend/index.md": {
        sha256: hashText(remoteIndex),
        managedBy: "hub",
      },
      ".suncode/spec/cli/backend/new-rule.md": {
        sha256: hashText(remoteNew),
        managedBy: "hub",
      },
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer login-token",
    });
    const minioIndexCall = fetch.mock.calls.find(
      ([url]) => String(url) === "https://minio.example.test/download/index",
    );
    const minioNewCall = fetch.mock.calls.find(
      ([url]) => String(url) === "https://minio.example.test/download/new",
    );
    expect(minioIndexCall?.[1]?.method).toBe("GET");
    expect(minioNewCall?.[1]?.method).toBe("GET");
    expect(minioIndexCall?.[1]?.headers ?? {}).not.toMatchObject({
      authorization: "Bearer login-token",
    });
    expect(minioNewCall?.[1]?.headers ?? {}).not.toMatchObject({
      authorization: "Bearer login-token",
    });
  });

  it("pull-spec adds the Hub JWT when the spec download URL is a Hub system API", async () => {
    const remoteText = "# Quality\n";
    const downloadUrl =
      "https://hub.example.test/api/v1/projects/proj_123/specs/files/quality-guidelines";
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === downloadUrl) {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer login-token",
        });
        return textResponse(remoteText);
      }
      return jsonResponse({
        revision: "spec-rev-system-download",
        files: [
          {
            path: "mchs-op/backend/quality-guidelines.md",
            sha256: hashText(remoteText),
            download: {
              url: downloadUrl,
              method: "GET",
            },
          },
        ],
      });
    });

    const result = await pullHubSpecs({ cwd: tmpDir, homeDir, fetch });

    expect(result.status).toBe("updated");
    expect(fetch).toHaveBeenCalledWith(
      downloadUrl,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer login-token",
        }),
      }),
    );
    expect(
      fs.readFileSync(
        path.join(
          tmpDir,
          ".suncode",
          "spec",
          "mchs-op",
          "backend",
          "quality-guidelines.md",
        ),
        "utf-8",
      ),
    ).toBe(remoteText);
  });

  it("pull-spec fails closed without writing success manifest when bundle hashes are invalid", async () => {
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url) === "https://minio.example.test/download/bad") {
        return textResponse("# Remote index\n");
      }
      return jsonResponse({
        revision: "spec-rev-bad",
        files: [
          {
            path: "cli/backend/index.md",
            sha256: "not-the-content-hash",
            download: {
              url: "https://minio.example.test/download/bad",
              method: "GET",
            },
          },
        ],
      });
    });

    await expect(
      pullHubSpecs({ cwd: tmpDir, homeDir, fetch }),
    ).rejects.toThrow("sha256");

    expect(
      fs.existsSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpDir, ".suncode", "spec", "cli", "backend", "index.md"),
      ),
    ).toBe(false);
  });

  it("pull-spec includes the download URL in failures when debug logging is enabled", async () => {
    const downloadUrl =
      "https://minio.example.test/download/private?X-Amz-Signature=debug";
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url) === downloadUrl) {
        return textResponse("unauthorized", 401);
      }
      return jsonResponse({
        revision: "spec-rev-401",
        files: [
          {
            path: "mchs-op/backend/quality-guidelines.md",
            download: {
              url: downloadUrl,
              method: "GET",
            },
          },
        ],
      });
    });
    const previousDebug = process.env.SUNCODE_HUB_DEBUG_DOWNLOAD_URL;
    process.env.SUNCODE_HUB_DEBUG_DOWNLOAD_URL = "1";

    try {
      await expect(
        pullHubSpecs({ cwd: tmpDir, homeDir, fetch }),
      ).rejects.toThrow(
        `Hub spec download failed for .suncode/spec/mchs-op/backend/quality-guidelines.md: HTTP 401; download URL: ${downloadUrl}`,
      );
    } finally {
      if (previousDebug === undefined) {
        delete process.env.SUNCODE_HUB_DEBUG_DOWNLOAD_URL;
      } else {
        process.env.SUNCODE_HUB_DEBUG_DOWNLOAD_URL = previousDebug;
      }
    }
  });

  it("pull-spec fails closed when login is missing, service fails, or bundle paths are invalid", async () => {
    const missingLoginHome = path.join(tmpDir, "missing-login-home");
    const skippedFetch = vi.fn();

    await expect(
      pullHubSpecs({ cwd: tmpDir, homeDir: missingLoginHome, fetch: skippedFetch }),
    ).rejects.toThrow("login");
    expect(skippedFetch).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"),
      ),
    ).toBe(false);

    const serviceFetch = vi.fn(async () => {
      throw new Error("service down");
    });
    await expect(
      pullHubSpecs({ cwd: tmpDir, homeDir, fetch: serviceFetch }),
    ).rejects.toThrow("service down");
    expect(
      fs.existsSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"),
      ),
    ).toBe(false);

    const invalidPathFetch = vi.fn(async () =>
      jsonResponse({
        revision: "spec-rev-bad-path",
        files: [
          {
            path: "../outside.md",
            sha256: hashText("# Outside\n"),
            download: {
              url: "https://minio.example.test/download/outside",
              method: "GET",
            },
          },
        ],
      }),
    );
    await expect(
      pullHubSpecs({ cwd: tmpDir, homeDir, fetch: invalidPathFetch }),
    ).rejects.toThrow("Invalid Hub spec path");
    expect(
      fs.existsSync(
        path.join(tmpDir, ".suncode", ".runtime", "hub-specs.json"),
      ),
    ).toBe(false);
  });

  it("keeps and discards deletion candidates through fixed commands", async () => {
    const backupPath = path.join(
      tmpDir,
      ".suncode",
      ".runtime",
      "hub-spec-deletions",
      "spec-rev-42",
      "cli",
      "backend",
      "old-rule.md",
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, "# Old useful rule\n", "utf-8");
    writeSpecDeletionManifest(tmpDir, "spec-rev-42", {
      version: 1,
      revision: "spec-rev-42",
      deletedAt: "2026-07-01T12:00:00.000Z",
      items: [
        {
          id: "del_001",
          previousPath: ".suncode/spec/cli/backend/old-rule.md",
          backupPath:
            ".suncode/.runtime/hub-spec-deletions/spec-rev-42/cli/backend/old-rule.md",
          previousSha256: hashText("# Old useful rule\n"),
          reason: "remote deleted this Hub-managed spec",
          status: "pending",
        },
      ],
    });

    expect(listSpecDeletions({ cwd: tmpDir }).items).toHaveLength(1);
    await expect(
      keepSpecDeletion({
        cwd: tmpDir,
        id: "del_001",
        asPath: ".suncode/spec/cli/backend/old-rule.md",
      }),
    ).rejects.toThrow(".suncode/spec/local/");

    const keep = await keepSpecDeletion({
      cwd: tmpDir,
      id: "del_001",
      asPath: ".suncode/spec/local/old-rule.md",
    });

    expect(keep.status).toBe("updated");
    const keptText = fs.readFileSync(
      path.join(tmpDir, ".suncode", "spec", "local", "old-rule.md"),
      "utf-8",
    );
    expect(keptText).toContain("本地补充");
    expect(keptText).toContain("# Old useful rule");
    expect(listSpecDeletions({ cwd: tmpDir }).items[0]?.status).toBe("kept");

    const discard = await discardSpecDeletion({ cwd: tmpDir, id: "del_001" });

    expect(discard.status).toBe("updated");
    expect(listSpecDeletions({ cwd: tmpDir }).items[0]?.status).toBe(
      "discarded",
    );
  });
});

describe("hub task resolution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves --task current from the session runtime pointer", () => {
    const taskJsonPath = makeTask(tmpDir);
    makeTask(tmpDir, "06-30-unrelated");
    writeJson(
      path.join(
        tmpDir,
        ".suncode",
        ".runtime",
        "sessions",
        "session-a.json",
      ),
      { current_task: ".suncode/tasks/06-30-payment-retry" },
    );

    expect(
      resolveTaskJsonPath({
        cwd: tmpDir,
        task: "current",
        env: { SUNCODE_CONTEXT_ID: "session-a" },
      }),
    ).toBe(taskJsonPath);
  });

  it("refuses --task current when multiple sessions exist and no context key is available", () => {
    makeTask(tmpDir);
    writeJson(
      path.join(
        tmpDir,
        ".suncode",
        ".runtime",
        "sessions",
        "session-a.json",
      ),
      { current_task: ".suncode/tasks/06-30-payment-retry" },
    );
    writeJson(
      path.join(
        tmpDir,
        ".suncode",
        ".runtime",
        "sessions",
        "session-b.json",
      ),
      { current_task: ".suncode/tasks/06-30-other" },
    );

    expect(() =>
      resolveTaskJsonPath({ cwd: tmpDir, task: "current", env: {} }),
    ).toThrow(HubTaskError);
  });
});

describe("hub state prompt", () => {
  function state(partial: Partial<HubStateResult>): HubStateResult {
    return {
      version: 1,
      refreshedAt: "2026-07-03T00:00:00.000Z",
      summary: {
        hub: "on",
        config: "ok",
        login: "ok",
        service: "ok",
        work: "none",
        currentTask: "none",
      },
      message: "ok",
      nextAction: "next",
      ...partial,
    };
  }

  it("formats Hub off as a one-line guardrail", () => {
    const prompt = formatHubStatePrompt(
      state({
        summary: {
          hub: "off",
          config: "off",
          login: "skipped",
          service: "skipped",
          work: "skipped",
          currentTask: "none",
        },
      }),
    );

    expect(prompt).toBe(
      "<hub-state>hub:off; use local workflow unless user asks for Hub</hub-state>",
    );
  });

  it("formats local-only state with a compact do-not guardrail", () => {
    const prompt = formatHubStatePrompt(
      state({
        summary: {
          hub: "on",
          config: "ok",
          login: "ok",
          service: "ok",
          work: "available",
          currentTask: "local-only",
        },
        work: { availableCount: 3, items: [] },
        currentTask: { state: "local-only", taskId: "local", reason: "test" },
      }),
    );

    expect(prompt).toContain("hub:ok");
    expect(prompt).toContain("workflow:primary");
    expect(prompt).toContain("hub-task:local-only");
    expect(prompt).toContain("work:3 available");
    expect(prompt).toContain("allowed:intake");
    expect(prompt).toContain(
      "do-not:submit-plan submit-completion mark-started",
    );
    expect(prompt).not.toContain("Flow add-on");
  });

  it("formats Hub-bound state with allowed high-level actions", () => {
    const prompt = formatHubStatePrompt(
      state({
        summary: {
          hub: "on",
          config: "ok",
          login: "ok",
          service: "ok",
          work: "available",
          currentTask: "hub-bound",
        },
        work: { availableCount: 2, items: [] },
        currentTask: { state: "hub-bound", taskId: "hub", reason: "test" },
      }),
    );

    expect(prompt).toContain("hub:ok");
    expect(prompt).toContain("hub-task:hub-bound");
    expect(prompt).toContain("work:2 available");
    expect(prompt).toContain("allowed:intake sync plan-ready pull-review finish");
    expect(prompt).not.toContain(" submit-plan review ");
    expect(prompt).toContain("blocked:none");
  });

  it("formats service failures as fail-closed", () => {
    const prompt = formatHubStatePrompt(
      state({
        summary: {
          hub: "on",
          config: "ok",
          login: "ok",
          service: "unavailable",
          work: "skipped",
          currentTask: "hub-bound",
        },
        message: "Hub service unavailable: timeout",
      }),
    );

    expect(prompt).toContain("hub:server-error");
    expect(prompt).toContain("blocked:service-unavailable");
    expect(prompt).toContain("do-not:hub-workflow");
  });
});

describe("hub commands", () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
    homeDir = path.join(tmpDir, "home");
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  startReviewPolicy: confirm",
        "",
      ].join("\n"),
    );
    writeHubAuth(homeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers the latest-review Hub command", () => {
    const program = new Command();
    registerHubCommand(program);

    const hub = program.commands.find((command) => command.name() === "hub");
    expect(hub?.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        "finish",
        "intake",
        "knowledge",
        "latest-review",
        "plan-ready",
        "skill-pull",
        "skill-push",
        "sync-pending",
      ]),
    );
  });

  it("sync-pending retries queued Hub sync failures and keeps remaining failures", () => {
    const runtimeDir = path.join(tmpDir, ".suncode", ".runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const queuePath = path.join(runtimeDir, "hub-sync-queue.jsonl");
    fs.writeFileSync(
      queuePath,
      [
        JSON.stringify({
          taskJsonPath: "/tmp/task-ok.json",
          event: "after_start",
          command: "ok-command",
          error: "failed",
          attempt: 1,
          firstFailedAt: "2026-07-03T00:00:00.000Z",
          lastFailedAt: "2026-07-03T00:00:00.000Z",
          nextRetryAt: "2026-07-03T00:00:00.000Z",
        }),
        JSON.stringify({
          taskJsonPath: "/tmp/task-fail.json",
          event: "after_archive",
          command: "fail-command",
          error: "failed",
          attempt: 1,
          firstFailedAt: "2026-07-03T00:00:00.000Z",
          lastFailedAt: "2026-07-03T00:00:00.000Z",
          nextRetryAt: "2026-07-03T00:00:00.000Z",
        }),
        "",
      ].join("\n"),
      "utf-8",
    );
    const seen: string[] = [];

    const result = syncPending({
      cwd: tmpDir,
      now: "2026-07-03T01:00:00.000Z",
      runner: (entry) => {
        seen.push(entry.command);
        return entry.command === "ok-command"
          ? { status: 0 }
          : { status: 7, error: "still failing" };
      },
    });

    expect(result.status).toBe("updated");
    expect(result.message).toContain("retried 2");
    expect(seen).toEqual(["ok-command", "fail-command"]);
    const remaining = fs
      .readFileSync(queuePath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      command: "fail-command",
      attempt: 2,
      error: "still failing",
      lastFailedAt: "2026-07-03T01:00:00.000Z",
    });
  });

  it("skill-push uploads every local .agents skill file through presign, PUT, and finalize", async () => {
    const skillDir = path.join(tmpDir, ".agents", "skills", "code-review");
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Code Review\n", "utf-8");
    fs.writeFileSync(
      path.join(skillDir, "references", "rules.md"),
      "# Rules\n",
      "utf-8",
    );
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body === undefined
            ? undefined
            : Buffer.from(init.body as ArrayBuffer).toString("utf-8");
      calls.push({ url: String(url), method, headers, body });

      if (method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (String(url).endsWith("/skill-packages/presign-upload")) {
        const payload = JSON.parse(body ?? "{}") as {
          file_path: string;
          content_type: string;
        };
        return jsonResponse({
          presign: {
            upload_url: `https://minio.example.test/upload/${payload.file_path}`,
            method: "PUT",
            object_key: `skills/project/proj_123/code-review/${payload.file_path}`,
            headers: { "Content-Type": payload.content_type },
          },
        });
      }
      if (String(url).endsWith("/skill-packages/finalize-upload")) {
        return jsonResponse({
          skill_package: {
            id: 7,
            scope: "project",
            project_key: "proj_123",
            name: "code-review",
            file_count: 2,
            files: [],
          },
        });
      }
      throw new Error(`Unexpected fetch call: ${method} ${String(url)}`);
    });

    const result = await hubSkillPush({
      cwd: tmpDir,
      homeDir,
      skillName: "code-review",
      fetch,
    });

    expect(result).toEqual({
      status: "submitted",
      message: "skill package code-review uploaded (2 file(s)).",
    });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      [
        "POST",
        "https://hub.example.test/api/agent-hub/skill-packages/presign-upload",
      ],
      ["PUT", "https://minio.example.test/upload/SKILL.md"],
      [
        "POST",
        "https://hub.example.test/api/agent-hub/skill-packages/finalize-upload",
      ],
      [
        "POST",
        "https://hub.example.test/api/agent-hub/skill-packages/presign-upload",
      ],
      ["PUT", "https://minio.example.test/upload/references/rules.md"],
      [
        "POST",
        "https://hub.example.test/api/agent-hub/skill-packages/finalize-upload",
      ],
    ]);
    expect(calls[0]?.headers.authorization).toBe("Bearer login-token");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      scope: "project",
      project_key: "proj_123",
      skill_name: "code-review",
      file_path: "SKILL.md",
      size: Buffer.byteLength("# Code Review\n"),
      content_type: "text/markdown",
    });
    expect(calls[1]?.headers["content-type"]).toBe("text/markdown");
    expect(calls[1]?.body).toBe("# Code Review\n");
    expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({
      scope: "project",
      project_key: "proj_123",
      skill_name: "code-review",
      file_path: "SKILL.md",
      object_key: "skills/project/proj_123/code-review/SKILL.md",
    });
  });

  it("skill-push requires a local SKILL.md at the skill package root", async () => {
    fs.mkdirSync(path.join(tmpDir, ".agents", "skills", "broken-skill"), {
      recursive: true,
    });

    await expect(
      hubSkillPush({
        cwd: tmpDir,
        homeDir,
        skillName: "broken-skill",
        fetch: vi.fn(),
      }),
    ).rejects.toThrow("SKILL.md");
  });

  it("skill-pull downloads a Hub skill package into .agents/skills and overwrites same-name files", async () => {
    const skillDir = path.join(tmpDir, ".agents", "skills", "code-review");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Old\n", "utf-8");
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(url), method, headers });

      if (
        String(url) ===
        "https://hub.example.test/api/agent-hub/projects/proj_123/skill-packages"
      ) {
        return jsonResponse({
          skill_packages: [
            {
              id: 7,
              scope: "project",
              project_key: "proj_123",
              name: "code-review",
              file_count: 2,
            },
          ],
        });
      }
      if (
        String(url) ===
        "https://hub.example.test/api/agent-hub/skill-packages/7"
      ) {
        return jsonResponse({
          skill_package: {
            id: 7,
            scope: "project",
            project_key: "proj_123",
            name: "code-review",
            file_count: 2,
            files: [
              { id: 71, relative_path: "SKILL.md", file_name: "SKILL.md" },
              {
                id: 72,
                relative_path: "references/rules.md",
                file_name: "rules.md",
              },
            ],
          },
        });
      }
      if (
        String(url) ===
        "https://hub.example.test/api/agent-hub/skill-package-files/71/content"
      ) {
        return textResponse("# New\n");
      }
      if (
        String(url) ===
        "https://hub.example.test/api/agent-hub/skill-package-files/72/content"
      ) {
        return textResponse("# Rules\n");
      }
      throw new Error(`Unexpected fetch call: ${method} ${String(url)}`);
    });

    const result = await hubSkillPull({
      cwd: tmpDir,
      homeDir,
      skillName: "code-review",
      fetch,
    });

    expect(result).toEqual({
      status: "downloaded",
      message: "skill package code-review downloaded (2 file(s)).",
    });
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toBe(
      "# New\n",
    );
    expect(
      fs.readFileSync(path.join(skillDir, "references", "rules.md"), "utf-8"),
    ).toBe("# Rules\n");
    expect(calls.every((call) => call.headers.authorization === "Bearer login-token")).toBe(
      true,
    );
  });

  it("skill-pull rejects Hub file paths that would escape the local skill directory", async () => {
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/projects/proj_123/skill-packages")) {
        return jsonResponse({
          skill_packages: [
            { id: 7, scope: "project", project_key: "proj_123", name: "bad" },
          ],
        });
      }
      if (String(url).endsWith("/skill-packages/7")) {
        return jsonResponse({
          skill_package: {
            id: 7,
            name: "bad",
            files: [
              {
                id: 71,
                relative_path: "../escape.md",
                file_name: "escape.md",
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    await expect(
      hubSkillPull({
        cwd: tmpDir,
        homeDir,
        skillName: "bad",
        fetch,
      }),
    ).rejects.toThrow("Invalid skill package file path");
    expect(fs.existsSync(path.join(tmpDir, ".agents", "skills", "escape.md"))).toBe(
      false,
    );
  });

  it("knowledge searches the current Hub project knowledge base with compact AI-facing output and default top_k 3", async () => {
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url: String(url), method, headers, body });

      return jsonResponse({
        artifacts: [
          {
            artifact: {
              id: 12,
              title: "登录接口",
              side: "backend",
              module: "auth",
              endpoint_path: "POST /api/auth/login",
              tags: ["登录", "鉴权"],
            },
            score: 0.9125,
            snippet: "请求体包含 email 和 password。",
          },
        ],
        count: 1,
      });
    });

    const result = await hubKnowledgeSearch({
      cwd: tmpDir,
      homeDir,
      query: "登录接口字段",
      fetch,
    });

    expect(result).toEqual({
      query: "登录接口字段",
      results: [
        {
          title: "登录接口",
          module: "auth",
          endpointPath: "POST /api/auth/login",
          snippet: "请求体包含 email 和 password。",
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://hub.example.test/api/agent-hub/projects/proj_123/knowledge/vector-search",
    });
    expect(calls[0]?.headers.authorization).toBe("Bearer login-token");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      query: "登录接口字段",
      top_k: 3,
    });
  });

  it("knowledge accepts a custom top_k", async () => {
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url: String(url), method, headers, body });
      return jsonResponse({ artifacts: [], count: 0 });
    });

    const result = await hubKnowledgeSearch({
      cwd: tmpDir,
      homeDir,
      query: "页面契约",
      topK: 12,
      fetch,
    });

    expect(result).toEqual({
      query: "页面契约",
      results: [],
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      query: "页面契约",
      top_k: 12,
    });
  });

  it("knowledge rejects empty query and invalid top_k before calling Hub", async () => {
    const fetch = vi.fn();

    await expect(
      hubKnowledgeSearch({
        cwd: tmpDir,
        homeDir,
        query: "   ",
        fetch,
      }),
    ).rejects.toThrow("Knowledge query is required.");
    await expect(
      hubKnowledgeSearch({
        cwd: tmpDir,
        homeDir,
        query: "接口契约",
        topK: 21,
        fetch,
      }),
    ).rejects.toThrow("Knowledge top_k must be an integer between 1 and 20.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("knowledge returns disabled without calling Hub", async () => {
    writeProjectConfig(tmpDir, ["hub:", "  enabled: false", ""].join("\n"));
    const fetch = vi.fn();

    const result = await hubKnowledgeSearch({
      cwd: tmpDir,
      homeDir,
      query: "接口契约",
      fetch,
    });

    expect(result.status).toBe("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("create-task is idempotent and records remote binding locally", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const { calls, fetch } = createMockFetch();

    const result = await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    expect(result.status).toBe("created");
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe(
      "https://hub.example.test/api/v1/projects/proj_123/requirements/REQ-1001/tasks",
    );
    expect(post?.headers.authorization).toBe("Bearer login-token");
    expect(post?.headers["idempotency-key"]).toBe(
      "hub:create-task:proj_123:REQ-1001:06-30-payment-retry",
    );

    const manifest = loadHubManifest(path.dirname(taskJsonPath));
    expect(manifest.remoteTaskId).toBe("TASK-2001");
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    expect(taskJson.meta.hub.remoteTaskId).toBe("TASK-2001");
    expect(taskJson.meta.hub.bindingStatus).toBe("bound");

    calls.length = 0;
    const second = await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });
    expect(second.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("hub intake does not auto-select when multiple requirements are available", async () => {
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && String(url).includes("/requirements?")) {
        return jsonResponse({
          requirements: [
            { id: "REQ-1001", title: "登录状态识别", revision: 7 },
            { id: "REQ-1002", title: "订单同步", revision: 3 },
          ],
        });
      }
      throw new Error(`Unexpected fetch call: ${method} ${String(url)}`);
    });

    const result = await hubIntake({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
      auto: true,
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("ambiguous");
    expect(fs.existsSync(path.join(tmpDir, ".suncode", "tasks"))).toBe(false);
  });

  it("hub intake creates a HUB-REQ-prefixed local task for a single Chinese requirement", async () => {
    const { fetch } = createMockFetch();

    const result = await hubIntake({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
      auto: true,
    });

    expect(result.status).toBe("created");
    const tasksDir = path.join(tmpDir, ".suncode", "tasks");
    const taskDirName = fs
      .readdirSync(tasksDir)
      .find((name) => name.endsWith("hub-req-1001"));
    expect(taskDirName).toBeDefined();
    const taskJsonPath = path.join(tasksDir, taskDirName ?? "", "task.json");
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      id: string;
      name: string;
      title: string;
      meta: { hub: Record<string, unknown> };
    };
    expect(taskJson.id).toBe("hub-req-1001");
    expect(taskJson.name).toBe("HUB-REQ-1001 登录状态识别");
    expect(taskJson.title).toBe("HUB-REQ-1001 登录状态识别");
    expect(taskJson.meta.hub).toMatchObject({
      requirementId: "REQ-1001",
      requirementRevision: 7,
      remoteTaskId: "TASK-2001",
      bindingStatus: "bound",
    });
    expect(
      fs.readFileSync(path.join(tasksDir, taskDirName ?? "", "prd.md"), "utf-8"),
    ).toContain("识别用户登录状态。");
  });

  it("reads the latest local review result without Hub config, auth, or network", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.rmSync(path.join(tmpDir, ".suncode", "config.yaml"), { force: true });
    writeJson(path.join(taskDir, "reviews", "round-001", "review.json"), {
      round: 1,
      status: "changes_requested",
      summary: "旧 review。",
    });
    fs.writeFileSync(
      path.join(taskDir, "reviews", "round-001", "result.md"),
      "# Old Review\n",
      "utf-8",
    );
    writeJson(path.join(taskDir, "reviews", "round-002", "review.json"), {
      round: 2,
      status: "approved",
      summary: "最新 review 已通过。",
      mustFix: [],
      advisory: [{ title: "Optional note" }],
    });
    fs.writeFileSync(
      path.join(taskDir, "reviews", "round-002", "result.md"),
      "# Latest Review\n\n最新 review 已通过。\n",
      "utf-8",
    );
    const fetch = vi.fn(async () => {
      throw new Error("network should not be used for local review results");
    });

    const result = await pullLatestReview({
      cwd: tmpDir,
      homeDir: path.join(tmpDir, "missing-home"),
      taskJsonPath,
      env: {},
      fetch,
    });

    expect(result).toMatchObject({
      status: "found",
      round: 2,
      roundName: "round-002",
      files: {
        reviewJson: "reviews/round-002/review.json",
        resultMarkdown: "reviews/round-002/result.md",
      },
      review: {
        round: 2,
        status: "approved",
        summary: "最新 review 已通过。",
      },
      resultMarkdown: "# Latest Review\n\n最新 review 已通过。\n",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("旧 review");
  });

  it("includes parent remote task in child task idempotency keys", async () => {
    const taskJsonPath = makeTask(tmpDir, "06-30-payment-retry-api");
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: {
        hub: Record<string, unknown>;
      };
    };
    taskJson.meta.hub.taskRole = "child";
    taskJson.meta.hub.parentLocalTaskId = "06-30-payment-retry";
    taskJson.meta.hub.parentRemoteTaskId = "TASK-2001";
    writeJson(taskJsonPath, taskJson);
    const { calls, fetch } = createMockFetch();

    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const post = calls.find((call) => call.method === "POST");
    expect(post?.headers["idempotency-key"]).toBe(
      "hub:create-task:proj_123:REQ-1001:TASK-2001:06-30-payment-retry-api",
    );
  });

  it("uses the human task title as the Hub local task name", async () => {
    const taskJsonPath = makeTask(tmpDir, "06-30-login-state");
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      name: string;
      title: string;
    };
    taskJson.name = "login-state";
    taskJson.title = "登录状态识别";
    writeJson(taskJsonPath, taskJson);
    const { calls, fetch } = createMockFetch();

    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
    });

    const post = calls.find((call) => call.method === "POST");
    const payload = JSON.parse(post?.body ?? "{}") as {
      localTaskName?: string;
      title?: string;
    };
    expect(payload.localTaskName).toBe("登录状态识别");
    expect(payload.title).toBe("登录状态识别");
  });

  it("submit-plan uploads file bodies to Hub upload targets with login auth and sends only object refs to Hub", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(path.join(taskDir, "implement.md"), "# Impl\n", "utf-8");

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls } = createMockFetch();
    const trackedFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const mock = createMockFetch();
      const response = await mock.fetch(url, init);
      calls.push(...mock.calls);
      return response;
    });

    const result = await submitPlan({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("submitted");
    const uploadCalls = calls.filter((call) => call.method === "PUT");
    expect(uploadCalls).toHaveLength(3);
    expect(uploadCalls.map((call) => call.headers.authorization)).toEqual([
      "Bearer login-token",
      "Bearer login-token",
      "Bearer login-token",
    ]);

    const submission = calls.find((call) =>
      call.url.endsWith("/plan-submissions"),
    );
    expect(submission).toBeDefined();
    expect(submission?.body).not.toContain('"content"');
    expect(submission?.body).not.toContain("# Design");
    expect(JSON.parse(submission?.body ?? "{}").artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "prd.md",
          storage: "minio",
          objectRef: expect.objectContaining({ provider: "minio" }),
        }),
      ]),
    );

    const manifestText = fs.readFileSync(
      path.join(taskDir, "hub-manifest.json"),
      "utf-8",
    );
    expect(manifestText).not.toContain("uploadUrl");
    expect(manifestText).not.toContain("artifact-upload-sessions/UPLOAD-9001/uploads");
  });

  it("submit-spec treats .suncode/spec as project-level artifacts", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "cli"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".suncode", "spec", "cli", "contract.md"),
      "# Contract\n",
      "utf-8",
    );
    const unrelatedTask = path.join(
      tmpDir,
      ".suncode",
      "tasks",
      "06-30-unrelated",
    );
    fs.mkdirSync(unrelatedTask, { recursive: true });
    fs.writeFileSync(path.join(unrelatedTask, "prd.md"), "# Wrong PRD\n");

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const calls: FetchCall[] = [];
    const trackedFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const mock = createMockFetch();
      const response = await mock.fetch(url, init);
      calls.push(...mock.calls);
      return response;
    });

    const result = await submitSpec({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("submitted");
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);

    const uploadSession = calls.find((call) =>
      call.url.endsWith("/artifact-upload-sessions"),
    );
    expect(JSON.parse(uploadSession?.body ?? "{}")).toMatchObject({
      artifactScope: "project_spec",
      submissionKind: "spec",
      artifacts: [
        {
          path: ".suncode/spec/cli/contract.md",
          type: "spec",
        },
      ],
    });

    const submission = calls.find((call) =>
      call.url.endsWith("/spec-submissions"),
    );
    expect(submission?.body).not.toContain("Wrong PRD");
    expect(JSON.parse(submission?.body ?? "{}")).toMatchObject({
      artifactScope: "project_spec",
      specBundleHash: expect.any(String),
      artifacts: [
        {
          path: ".suncode/spec/cli/contract.md",
          storage: "minio",
        },
      ],
    });

    const projectManifest = loadProjectSpecManifest(tmpDir);
    expect(
      projectManifest.artifacts[".suncode/spec/cli/contract.md"]
        ?.lastSubmittedSha256,
    ).toEqual(expect.any(String));
    expect(loadHubManifest(taskDir).artifacts).toEqual({});
  });

  it("submit-subtasks sends only the current task structured subtasks to Hub", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    writeJson(path.join(taskDir, "subtasks.json"), {
      version: 1,
      subtasks: [
        {
          priority: "P1",
          name: "Persist retry policy",
          description: "Add storage and validation for retry settings.",
        },
        {
          priority: "P2",
          name: "Expose retry status",
          description: "Show retry state in task status responses.",
        },
      ],
    });
    const unrelatedTask = path.join(
      tmpDir,
      ".suncode",
      "tasks",
      "06-30-unrelated",
    );
    fs.mkdirSync(unrelatedTask, { recursive: true });
    writeJson(path.join(unrelatedTask, "subtasks.json"), {
      version: 1,
      subtasks: [
        {
          priority: "P0",
          name: "Wrong task",
          description: "This must not be uploaded.",
        },
      ],
    });

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls, fetch: trackedFetch } = createMockFetch();
    const result = await submitSubtasks({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("submitted");
    const submission = calls.find((call) => call.url.endsWith("/subtasks"));
    expect(submission).toBeDefined();
    expect(submission?.headers["idempotency-key"]).toMatch(
      /^hub:submit-subtasks:TASK-2001:/,
    );
    expect(JSON.parse(submission?.body ?? "{}")).toMatchObject({
      developerId: "dev_456",
      requirementId: "REQ-1001",
      localTaskId: "06-30-payment-retry",
      localTaskPath: ".suncode/tasks/06-30-payment-retry",
      subtasks: [
        {
          priority: "P1",
          name: "Persist retry policy",
          description: "Add storage and validation for retry settings.",
        },
        {
          priority: "P2",
          name: "Expose retry status",
          description: "Show retry state in task status responses.",
        },
      ],
    });
    expect(submission?.body).not.toContain("Wrong task");
    expect(loadHubManifest(taskDir).lastSubtasksHash).toEqual(
      expect.any(String),
    );

    calls.length = 0;
    const second = await submitSubtasks({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });
    expect(second.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("submit-subtasks generates structured subtasks from implement.md when no override exists", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      [
        "# Implementation",
        "",
        "- [ ] [P1] Persist retry policy: Add storage and validation for retry settings.",
        "- [ ] [P2] Expose retry status: Show retry state in task status responses.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls, fetch: trackedFetch } = createMockFetch();
    const result = await submitSubtasks({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("submitted");
    const submission = calls.find((call) => call.url.endsWith("/subtasks"));
    expect(JSON.parse(submission?.body ?? "{}")).toMatchObject({
      subtasks: [
        {
          priority: "P1",
          name: "Persist retry policy",
          description: "Add storage and validation for retry settings.",
        },
        {
          priority: "P2",
          name: "Expose retry status",
          description: "Show retry state in task status responses.",
        },
      ],
    });
  });

  it("hub plan-ready submits plan, generated subtasks, and preflight start", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      "- [ ] [P1] Persist retry policy: Add storage and validation.\n",
      "utf-8",
    );

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls, fetch: trackedFetch } = createMockFetch();
    const result = await hubPlanReady({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("updated");
    expect(calls.some((call) => call.url.endsWith("/plan-submissions"))).toBe(
      true,
    );
    expect(calls.some((call) => call.url.endsWith("/subtasks"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/preflight-start"))).toBe(
      true,
    );
  });

  it("hub plan-ready debug logs the failing step and request URL", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      "- [ ] [P1] Persist retry policy: Add storage and validation.\n",
      "utf-8",
    );

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { fetch: baseFetch } = createMockFetch();
    const trackedFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/preflight-start")) {
        throw new TypeError("fetch failed");
      }
      const response = await baseFetch(url, init);
      if (String(url).endsWith("/artifact-upload-sessions")) {
        const data = (await response.json()) as {
          uploads: { uploadUrl: string }[];
        };
        data.uploads = data.uploads.map((upload) => ({
          ...upload,
          uploadUrl: `${upload.uploadUrl}?X-Amz-Signature=secret-query&token=jwt-token`,
        }));
        return jsonResponse(data);
      }
      return response;
    });
    const logs: string[] = [];

    await expect(
      hubPlanReady({
        cwd: tmpDir,
        homeDir,
        taskJsonPath,
        env: { SUNCODE_HUB_TOKEN: "jwt-token" },
        fetch: trackedFetch,
        debug: true,
        logger: (message) => logs.push(message),
      }),
    ).rejects.toThrow(
      "plan-ready request failed: POST https://hub.example.test/api/v1/projects/proj_123/tasks/TASK-2001/preflight-start: fetch failed",
    );

    expect(logs).toContain("[hub plan-ready] start");
    expect(logs).toContain("[hub plan-ready] step submit-plan start");
    expect(logs).toContain("[hub plan-ready] step submit-subtasks ok: submitted");
    expect(logs).toContain("[hub plan-ready] step preflight-start start");
    expect(logs).toContain(
      "[hub plan-ready] request POST https://hub.example.test/api/v1/projects/proj_123/tasks/TASK-2001/preflight-start",
    );
    expect(logs).toContain(
      "[hub plan-ready] request POST https://hub.example.test/api/v1/projects/proj_123/tasks/TASK-2001/preflight-start failed: fetch failed",
    );
    expect(logs).toContain(
      "[hub plan-ready] step preflight-start failed: plan-ready request failed: POST https://hub.example.test/api/v1/projects/proj_123/tasks/TASK-2001/preflight-start: fetch failed",
    );
    expect(logs).toContain(
      "[hub plan-ready] request PUT https://hub.example.test/api/v1/projects/proj_123/artifact-upload-sessions/UPLOAD-9001/uploads/prd.md?[redacted]",
    );
    expect(logs.join("\n")).not.toContain("X-Amz-Signature");
    expect(logs.join("\n")).not.toContain("secret-query");
    expect(logs.join("\n")).not.toContain("jwt-token");
  });

  it("hub plan-ready stops before preflight when structured subtasks are missing", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(path.join(taskDir, "implement.md"), "# Plan\n", "utf-8");

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls, fetch: trackedFetch } = createMockFetch();
    const result = await hubPlanReady({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.message).toContain(
      "submit-subtasks skipped (No structured subtasks found.)",
    );
    expect(calls.some((call) => call.url.endsWith("/plan-submissions"))).toBe(
      true,
    );
    expect(calls.some((call) => call.url.endsWith("/subtasks"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/preflight-start"))).toBe(
      false,
    );
  });

  it("hub finish reports missing completion artifacts before uploading", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    await expect(
      hubFinish({
        cwd: tmpDir,
        homeDir,
        taskJsonPath,
        env: { SUNCODE_HUB_TOKEN: "jwt-token" },
        fetch,
      }),
    ).rejects.toThrow(
      "Missing completion artifacts: implementation-summary.md, validation-summary.md, retrospective.md, reuse-assessment.md",
    );
  });

  it("hub finish submits spec and completion artifacts", async () => {
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    fs.mkdirSync(path.join(tmpDir, ".suncode", "spec", "cli"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".suncode", "spec", "cli", "contract.md"),
      "# Contract\n",
      "utf-8",
    );
    for (const file of [
      "implementation-summary.md",
      "validation-summary.md",
      "retrospective.md",
      "reuse-assessment.md",
    ]) {
      fs.writeFileSync(path.join(taskDir, file), `# ${file}\n`, "utf-8");
    }

    const { fetch } = createMockFetch();
    await hubCreateTask({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch,
    });

    const { calls, fetch: trackedFetch } = createMockFetch();
    const result = await hubFinish({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      fetch: trackedFetch,
    });

    expect(result.status).toBe("updated");
    expect(calls.some((call) => call.url.endsWith("/spec-submissions"))).toBe(
      true,
    );
    expect(
      calls.some((call) => call.url.endsWith("/completion-submissions")),
    ).toBe(true);
  });

  it("hub review creates a review round, syncs statuses, and submits review artifacts", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    provider: engineer",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(path.join(taskDir, "implement.md"), "# Impl\n", "utf-8");
    const { calls, fetch } = createMockFetch();

    const result = await hubReview({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      modules: ["packages/cli/src/commands/hub"],
      fetch,
      provider: {
        name: "engineer",
        isAvailable: () => true,
        run: async () => ({
          exitCode: 0,
          output: [
            "Review complete.",
            "```json",
            JSON.stringify({
              status: "changes_requested",
              summary: "需要修复 review gate。",
              mustFix: [
                {
                  severity: "high",
                  file: "packages/cli/src/commands/hub/config.ts",
                  line: 42,
                  title: "Result report must not store raw provider log",
                  detail: "result.md should contain reviewer findings only.",
                },
              ],
              advisory: [
                {
                  severity: "low",
                  file: "docs-site/advanced/configuration.mdx",
                  title: "Document raw output location",
                  detail: "Mention raw-output.md for diagnostics.",
                },
              ],
            }),
            "```",
          ].join("\n"),
        }),
      },
    });

    expect(result.status).toBe("updated");
    const reviewJsonPath = path.join(
      taskDir,
      "reviews",
      "round-001",
      "review.json",
    );
    const review = JSON.parse(fs.readFileSync(reviewJsonPath, "utf-8")) as {
      round: number;
      provider: string;
      status: string;
      scope: string[];
      mustFixCount: number;
      advisoryCount: number;
      artifacts: Record<string, string>;
    };
    expect(review).toMatchObject({
      round: 1,
      provider: "engineer",
      status: "changes_requested",
      scope: ["packages/cli/src/commands/hub"],
      mustFixCount: 1,
      advisoryCount: 1,
      artifacts: {
        prompt: "reviews/round-001/prompt.md",
        result: "reviews/round-001/result.md",
        diff: "reviews/round-001/diff.patch",
        rawOutput: "reviews/round-001/raw-output.md",
      },
    });
    const resultMd = fs.readFileSync(
      path.join(taskDir, "reviews", "round-001", "result.md"),
      "utf-8",
    );
    expect(resultMd).toContain("# Hub Review Result");
    expect(resultMd).toContain("## Must Fix");
    expect(resultMd).toContain("Result report must not store raw provider log");
    expect(resultMd).toContain("packages/cli/src/commands/hub/config.ts:42");
    expect(resultMd).toContain("## Advisory");
    expect(resultMd).toContain("Document raw output location");
    expect(resultMd).not.toContain("Review complete.");
    const rawOutput = fs.readFileSync(
      path.join(taskDir, "reviews", "round-001", "raw-output.md"),
      "utf-8",
    );
    expect(rawOutput).toContain("Review complete.");
    expect(
      calls
        .filter((call) => call.method === "PATCH" && call.url.endsWith("/status"))
        .map((call) => (JSON.parse(call.body ?? "{}") as { status: string }).status),
    ).toEqual(["in_review", "changes_requested"]);
    const uploadSession = calls.find((call) =>
      call.url.endsWith("/artifact-upload-sessions"),
    );
    expect(JSON.parse(uploadSession?.body ?? "{}")).toMatchObject({
      submissionKind: "review",
      artifactScope: "current_task",
    });
    const reviewSubmission = calls.find((call) =>
      call.url.endsWith("/review-submissions"),
    );
    expect(JSON.parse(reviewSubmission?.body ?? "{}")).toMatchObject({
      reviewBundleHash: expect.any(String),
      review: {
        round: 1,
        status: "changes_requested",
        mustFixCount: 1,
        advisoryCount: 1,
      },
    });
    const manifest = loadHubManifest(taskDir);
    expect(manifest.lastReviewStatus).toBe("changes_requested");
    expect(manifest.lastReviewRound).toBe(1);
    expect(manifest.lastReviewSubmissionId).toBe("REVIEW-6001");
  });

  it("hub review advances rounds and status idempotency keys after local review artifacts are deleted", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    provider: engineer",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    const { calls, fetch } = createMockFetch();
    const provider = {
      name: "engineer" as const,
      isAvailable: () => true,
      run: async () => ({
        exitCode: 0,
        output: [
          "```json",
          JSON.stringify({
            status: "changes_requested",
            summary: "需要修复。",
            mustFix: [{ title: "Fix review finding" }],
            advisory: [],
          }),
          "```",
        ].join("\n"),
      }),
    };

    await hubReview({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
      provider,
    });
    fs.rmSync(path.join(taskDir, "reviews"), { recursive: true, force: true });
    await hubReview({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
      provider,
    });

    const reviewSubmissions = calls.filter((call) =>
      call.url.endsWith("/review-submissions"),
    );
    expect(
      reviewSubmissions.map(
        (call) =>
          (JSON.parse(call.body ?? "{}") as { review: { round: number } }).review
            .round,
      ),
    ).toEqual([1, 2]);
    expect(
      reviewSubmissions.map((call) => call.headers["idempotency-key"]),
    ).toEqual([
      expect.stringMatching(/^hub:submit-review:TASK-2001:1:/),
      expect.stringMatching(/^hub:submit-review:TASK-2001:2:/),
    ]);
    const statusKeys = calls
      .filter((call) => call.method === "PATCH" && call.url.endsWith("/status"))
      .map((call) => call.headers["idempotency-key"]);
    expect(new Set(statusKeys).size).toBe(statusKeys.length);
  });

  it("hub review can disable raw provider output artifacts", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    provider: engineer",
        "    engineer:",
        "      saveRawOutput: false",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    const { fetch } = createMockFetch();

    await hubReview({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
      provider: {
        name: "engineer",
        isAvailable: () => true,
        run: async () => ({
          exitCode: 0,
          output: [
            "Raw engineer execution transcript.",
            "```json",
            JSON.stringify({
              status: "approved",
              summary: "可以合并。",
              mustFix: [],
              advisory: [],
            }),
            "```",
          ].join("\n"),
        }),
      },
    });

    const roundDir = path.join(taskDir, "reviews", "round-001");
    const review = JSON.parse(
      fs.readFileSync(path.join(roundDir, "review.json"), "utf-8"),
    ) as { artifacts: Record<string, string> };
    const resultMd = fs.readFileSync(path.join(roundDir, "result.md"), "utf-8");

    expect(fs.existsSync(path.join(roundDir, "raw-output.md"))).toBe(false);
    expect(review.artifacts.rawOutput).toBeUndefined();
    expect(resultMd).toContain("可以合并。");
    expect(resultMd).not.toContain("Raw engineer execution transcript.");
  });

  it("hub review skips without changing status when the provider is unavailable and bypass is allowed", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    provider: engineer",
        "    unavailablePolicy: bypass",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    const { calls, fetch } = createMockFetch();

    const result = await hubReview({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
      provider: {
        name: "engineer",
        isAvailable: () => false,
        run: async () => {
          throw new Error("should not run");
        },
      },
    });

    expect(result).toEqual({
      status: "skipped",
      message: "Review provider engineer is unavailable.",
    });
    expect(fs.existsSync(path.join(taskDir, "reviews"))).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("submit-completion blocks when review is required and no approved current review exists", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    required: true",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    fs.writeFileSync(
      path.join(taskDir, "implementation-summary.md"),
      "# Done\n",
      "utf-8",
    );
    const { fetch } = createMockFetch();

    await expect(
      submitCompletion({
        cwd: tmpDir,
        homeDir,
        taskJsonPath,
        fetch,
      }),
    ).rejects.toThrow("approved Hub review");
  });

  it("submit-completion proceeds when the required approved review matches the current diff", async () => {
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "  review:",
        "    enabled: true",
        "    required: true",
        "",
      ].join("\n"),
    );
    const taskJsonPath = makeTask(tmpDir);
    const taskDir = path.dirname(taskJsonPath);
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      meta: { hub: Record<string, unknown> };
    };
    taskJson.meta.hub.remoteTaskId = "TASK-2001";
    taskJson.meta.hub.bindingStatus = "bound";
    writeJson(taskJsonPath, taskJson);
    fs.writeFileSync(
      path.join(taskDir, "implementation-summary.md"),
      "# Done\n",
      "utf-8",
    );
    writeJson(path.join(taskDir, "hub-manifest.json"), {
      version: 1,
      remoteTaskId: "TASK-2001",
      lastReviewStatus: "approved",
      approvedReviewDiffHash: hashText(""),
      artifacts: {},
    });
    const { calls, fetch } = createMockFetch();

    const result = await submitCompletion({
      cwd: tmpDir,
      homeDir,
      taskJsonPath,
      fetch,
    });

    expect(result.status).toBe("submitted");
    expect(calls.some((call) => call.url.endsWith("/completion-submissions"))).toBe(
      true,
    );
  });
});

describe("hub document downloads", () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hub-test-"));
    homeDir = path.join(tmpDir, "home");
    writeProjectConfig(
      tmpDir,
      [
        "hub:",
        "  enabled: true",
        "  projectId: proj_123",
        "  developerId: dev_456",
        "  apiBaseUrl: https://hub.example.test",
        "",
      ].join("\n"),
    );
    writeHubAuth(homeDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not use MinIO for text payloads", async () => {
    const fetch = vi.fn();
    const result = await downloadDocumentPayload({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      payload: { kind: "text", text: "short change", document: null },
      targetDir: tmpDir,
      fetch,
    });

    expect(result.kind).toBe("text");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads document payloads through a signed URL and verifies sha256", async () => {
    const body = "# Requirement\n";
    const sha256 = createHash("sha256").update(body, "utf-8").digest("hex");
    const calls: FetchCall[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      if (String(url).endsWith("/documents/DOC-1001/download-url")) {
        return jsonResponse({
          document: {
            documentId: "DOC-1001",
            filename: "requirement.md",
            contentType: "text/markdown",
            sha256,
            size: Buffer.byteLength(body),
          },
          download: {
            url: "https://minio.example.test/download/DOC-1001",
            method: "GET",
            expiresAt: "2026-06-30T12:15:00Z",
          },
        });
      }
      if (String(url).startsWith("https://minio.example.test/download/")) {
        return new Response(body, { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    const result = await downloadDocumentPayload({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      payload: {
        kind: "document",
        text: null,
        document: {
          documentId: "DOC-1001",
          filename: "requirement.md",
          contentType: "text/markdown",
          sha256,
          size: Buffer.byteLength(body),
          objectRef: { provider: "minio", objectKey: "objects/requirement.md" },
        },
      },
      targetDir: path.join(tmpDir, ".suncode", "tasks", "06-30-payment-retry"),
      fetch,
    });

    expect(result.kind).toBe("document");
    expect(result.localPath).toBe(
      path.join(
        tmpDir,
        ".suncode",
        "tasks",
        "06-30-payment-retry",
        "hub-sources",
        "requirement.md",
      ),
    );
    expect(fs.readFileSync(result.localPath, "utf-8")).toBe(body);
    expect(calls.map((call) => call.url)).toEqual([
      "https://hub.example.test/api/v1/projects/proj_123/documents/DOC-1001/download-url",
      "https://minio.example.test/download/DOC-1001",
    ]);
  });

  it("downloads explicit Hub documents into the project hub inbox by default", async () => {
    const body = "# Review\n";
    const sha256 = createHash("sha256").update(body, "utf-8").digest("hex");
    const fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/documents/DOC-2002/download-url")) {
        return jsonResponse({
          document: {
            documentId: "DOC-2002",
            filename: "review notes.md",
            contentType: "text/markdown",
            sha256,
            size: Buffer.byteLength(body),
          },
          download: {
            url: "https://minio.example.test/download/DOC-2002",
            method: "GET",
          },
        });
      }
      if (String(url).startsWith("https://minio.example.test/download/")) {
        return new Response(body, { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    const result = await downloadHubDocument({
      cwd: tmpDir,
      homeDir,
      env: { SUNCODE_HUB_TOKEN: "jwt-token" },
      documentId: "DOC-2002",
      filename: "fallback.md",
      fetch,
    });

    expect(result.kind).toBe("document");
    expect(result.localPath).toBe(
      path.join(
        tmpDir,
        ".suncode",
        "hub-inbox",
        "DOC-2002",
        "hub-sources",
        "review-notes.md",
      ),
    );
    expect(fs.readFileSync(result.localPath, "utf-8")).toBe(body);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".suncode",
          "tasks",
          "06-30-unrelated",
          "hub-sources",
        ),
      ),
    ).toBe(false);
  });
});
