import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HubConfigError,
  parseHubSection,
  resolveHubConfig,
} from "../../src/commands/hub/config.js";
import { hubInit } from "../../src/commands/hub/init.js";
import { hubLogin, hubLogout } from "../../src/commands/hub/login.js";
import { hubState } from "../../src/commands/hub/state.js";
import {
  collectPlanArtifacts,
  collectCompletionArtifacts,
  collectSpecArtifacts,
} from "../../src/commands/hub/artifacts.js";
import { hubCreateTask } from "../../src/commands/hub/create-task.js";
import {
  downloadDocumentPayload,
  downloadHubDocument,
} from "../../src/commands/hub/documents.js";
import { hashText } from "../../src/commands/hub/hash.js";
import {
  loadHubManifest,
  loadProjectSpecManifest,
} from "../../src/commands/hub/manifest.js";
import {
  submitPlan,
  submitSpec,
  submitSubtasks,
} from "../../src/commands/hub/submissions.js";
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
          uploadUrl: `https://minio.example.test/upload/${artifact.path}`,
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
      String(url).endsWith("/completion-submissions")
    ) {
      return jsonResponse({
        submission: {
          id: String(url).endsWith("/spec-submissions")
            ? "SPEC-4001"
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

  it("submit-plan uploads file bodies to MinIO and sends only object refs to Hub", async () => {
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
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(3);

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
    expect(manifestText).not.toContain("minio.example.test/upload");
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
