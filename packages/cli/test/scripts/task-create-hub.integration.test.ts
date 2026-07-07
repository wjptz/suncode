import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/suncode/scripts",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(tmp: string): void {
  const scriptsDest = path.join(tmp, ".suncode", "scripts");
  fs.mkdirSync(scriptsDest, { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, scriptsDest, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".suncode", ".developer"),
    "name=test-dev\ninitialized_at=2026-06-30T00:00:00\n",
  );
  fs.writeFileSync(path.join(tmp, ".suncode", "config.yaml"), "\n");
}

function runTaskCreate(repo: string, args: string[]): string {
  const result = spawnSync("python3", [".suncode/scripts/task.py", ...args], {
    cwd: repo,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `task.py ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

function runTaskStart(
  repo: string,
  taskPath: string,
  env: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  return spawnSync("python3", [".suncode/scripts/task.py", "start", taskPath], {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

function readTask(repo: string, taskPath: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(repo, taskPath, "task.json"), "utf-8"),
  ) as Record<string, unknown>;
}

function readHooks(repo: string, event: string): string[] {
  const code = [
    "import json, sys",
    "sys.path.insert(0, '.suncode/scripts')",
    "from common.config import get_hooks",
    `print(json.dumps(get_hooks(${JSON.stringify(event)})))`,
  ].join("\n");
  const result = spawnSync("python3", ["-c", code], {
    cwd: repo,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return JSON.parse(result.stdout) as string[];
}

function writeTeamHubConfig(repo: string): void {
  fs.writeFileSync(
    path.join(repo, ".suncode", "config.yaml"),
    [
      "hub:",
      "  enabled: true",
      "  mode: team",
      "  projectId: proj_123",
      "  apiBaseUrl: https://hub.example.test",
      "",
    ].join("\n"),
  );
}

function markTaskHubBound(
  repo: string,
  taskPath: string,
  taskType?: string,
): void {
  const taskJsonPath = path.join(repo, taskPath, "task.json");
  const task = JSON.parse(
    fs.readFileSync(taskJsonPath, "utf-8"),
  ) as Record<string, unknown>;
  task.meta = {
    ...(task.meta as Record<string, unknown> | undefined),
    hub: {
      projectId: "proj_123",
      developerId: "dev_456",
      requirementId: "REQ-1001",
      requirementRevision: 1,
      remoteTaskId: "TASK-2001",
      bindingStatus: "bound",
      ...(taskType ? { taskType } : {}),
    },
  };
  fs.writeFileSync(taskJsonPath, `${JSON.stringify(task, null, 2)}\n`);
}

function installFakeSuncode(
  repo: string,
  exitCode: number,
): { binDir: string; logPath: string } {
  const binDir = path.join(repo, "bin");
  const logPath = path.join(repo, "suncode-hook.log");
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    path.join(binDir, "suncode"),
    [
      "#!/bin/sh",
      `printf "%s\\n" "$*" >> ${JSON.stringify(logPath)}`,
      `exit ${exitCode}`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(path.join(binDir, "suncode"), 0o755);

  fs.writeFileSync(
    path.join(binDir, "suncode.cmd"),
    [`@echo off`, `echo %*>>"${logPath}"`, `exit /b ${exitCode}`, ""].join(
      "\r\n",
    ),
  );

  return { binDir, logPath };
}

function installEnvTaskJsonRequiredSuncode(
  repo: string,
): { binDir: string; logPath: string } {
  const binDir = path.join(repo, "bin");
  const logPath = path.join(repo, "suncode-hook.log");
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    path.join(binDir, "suncode"),
    [
      "#!/bin/sh",
      `printf "%s\\n" "$*" >> ${JSON.stringify(logPath)}`,
      `printf "TASK_JSON_PATH=%s\\n" "$TASK_JSON_PATH" >> ${JSON.stringify(logPath)}`,
      'case "$*" in',
      '  *"--task-json"*) echo "explicit --task-json should not be passed" >&2; exit 9 ;;',
      "esac",
      'if [ -z "$TASK_JSON_PATH" ]; then echo "TASK_JSON_PATH missing" >&2; exit 8; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  fs.chmodSync(path.join(binDir, "suncode"), 0o755);

  fs.writeFileSync(
    path.join(binDir, "suncode.cmd"),
    [
      "@echo off",
      `echo %*>>"${logPath}"`,
      `echo TASK_JSON_PATH=%TASK_JSON_PATH%>>"${logPath}"`,
      'echo %* | findstr /C:"--task-json" >nul',
      "if %ERRORLEVEL%==0 exit /b 9",
      'if "%TASK_JSON_PATH%"=="" exit /b 8',
      "exit /b 0",
      "",
    ].join("\r\n"),
  );

  return { binDir, logPath };
}

function installPreflightOkSyncFailSuncode(
  repo: string,
): { binDir: string; logPath: string } {
  const binDir = path.join(repo, "bin");
  const logPath = path.join(repo, "suncode-hook.log");
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    path.join(binDir, "suncode"),
    [
      "#!/bin/sh",
      `printf "%s\\n" "$*" >> ${JSON.stringify(logPath)}`,
      'case "$*" in',
      '  *"hub preflight-start"*) exit 0 ;;',
      "esac",
      'echo "sync failed" >&2',
      "exit 7",
      "",
    ].join("\n"),
  );
  fs.chmodSync(path.join(binDir, "suncode"), 0o755);

  fs.writeFileSync(
    path.join(binDir, "suncode.cmd"),
    [
      "@echo off",
      `echo %*>>"${logPath}"`,
      'echo %* | findstr /C:"hub preflight-start" >nul',
      "if %ERRORLEVEL%==0 exit /b 0",
      "echo sync failed 1>&2",
      "exit /b 7",
      "",
    ].join("\r\n"),
  );

  return { binDir, logPath };
}

describe.skipIf(!hasPython())("task.py create Hub metadata", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-task-hub-test-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes explicit Hub requirement metadata into task.json", () => {
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Hub task",
      "--slug",
      "hub-task",
      "--hub-project-id",
      "proj_123",
      "--hub-developer-id",
      "dev_456",
      "--hub-requirement-id",
      "REQ-1001",
      "--hub-requirement-revision",
      "7",
      "--hub-task-role",
      "parent",
    ]);

    const task = readTask(tmp, taskPath);
    expect(task.meta).toMatchObject({
      hub: {
        projectId: "proj_123",
        developerId: "dev_456",
        requirementId: "REQ-1001",
        requirementRevision: 7,
        taskRole: "parent",
        bindingStatus: "pending",
      },
    });
  });

  it("uses Chinese as the first language for generated task metadata and PRD", () => {
    const taskPath = runTaskCreate(tmp, [
      "create",
      "登录状态识别",
      "--slug",
      "login-state",
      "--hub-requirement-id",
      "REQ-1001",
    ]);

    const task = readTask(tmp, taskPath);
    expect(task.id).toBe("login-state");
    expect(task.name).toBe("登录状态识别");
    expect(task.title).toBe("登录状态识别");

    const prd = fs.readFileSync(path.join(tmp, taskPath, "prd.md"), "utf-8");
    expect(prd).toContain("# 登录状态识别");
    expect(prd).toContain("## 目标");
    expect(prd).toContain("## 需求");
    expect(prd).toContain("## 验收标准");
    expect(prd).toContain("优先使用简体中文");
  });

  it("inherits Hub requirement metadata when creating a child task", () => {
    const parentPath = runTaskCreate(tmp, [
      "create",
      "Parent Hub task",
      "--slug",
      "parent-hub-task",
      "--hub-project-id",
      "proj_123",
      "--hub-developer-id",
      "dev_456",
      "--hub-requirement-id",
      "REQ-1001",
      "--hub-requirement-revision",
      "7",
      "--hub-task-role",
      "parent",
    ]);
    const parentJsonPath = path.join(tmp, parentPath, "task.json");
    const parent = JSON.parse(
      fs.readFileSync(parentJsonPath, "utf-8"),
    ) as Record<string, unknown>;
    const parentMeta = parent.meta as { hub: Record<string, unknown> };
    parentMeta.hub.remoteTaskId = "TASK-2001";
    fs.writeFileSync(parentJsonPath, `${JSON.stringify(parent, null, 2)}\n`);

    const childPath = runTaskCreate(tmp, [
      "create",
      "Child Hub task",
      "--slug",
      "child-hub-task",
      "--parent",
      parentPath,
    ]);

    const child = readTask(tmp, childPath);
    expect(child.parent).toBe(path.basename(parentPath));
    expect(child.meta).toMatchObject({
      hub: {
        projectId: "proj_123",
        developerId: "dev_456",
        requirementId: "REQ-1001",
        requirementRevision: 7,
        taskRole: "child",
        parentLocalTaskId: path.basename(parentPath),
        parentRemoteTaskId: "TASK-2001",
        bindingStatus: "pending",
      },
    });
  });

  it("adds built-in Hub lifecycle hooks only when team Hub is enabled", () => {
    expect(readHooks(tmp, "after_create")).toEqual([]);

    writeTeamHubConfig(tmp);

    expect(readHooks(tmp, "after_create")).toContain(
      "suncode hub create-task --best-effort",
    );
    expect(readHooks(tmp, "before_start")).toEqual([
      "suncode hub preflight-start",
    ]);
    expect(readHooks(tmp, "after_start")).toEqual([
      "suncode hub submit-subtasks --best-effort",
      "suncode hub mark-started --best-effort",
    ]);
    expect(readHooks(tmp, "after_archive")).toContain(
      "suncode hub submit-completion --best-effort",
    );
    expect(readHooks(tmp, "after_finish")).toEqual([]);
  });

  it("does not run Hub before_start preflight for a local-only task", () => {
    writeTeamHubConfig(tmp);

    const taskPath = runTaskCreate(tmp, [
      "create",
      "Local task",
      "--slug",
      "local-task",
    ]);

    const result = runTaskStart(tmp, taskPath);

    expect(result.status).toBe(0);
    expect(readTask(tmp, taskPath).status).toBe("in_progress");
  });

  it("does not run Hub before_start preflight for a quick Hub task", () => {
    writeTeamHubConfig(tmp);
    const { binDir, logPath } = installFakeSuncode(tmp, 7);
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Quick Hub task",
      "--slug",
      "quick-hub-task",
      "--hub-requirement-id",
      "REQ-1001",
    ]);
    markTaskHubBound(tmp, taskPath, "quick");

    const result = runTaskStart(tmp, taskPath, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(logPath, "utf-8")).not.toContain(
      "hub preflight-start --task-json ",
    );
    expect(readTask(tmp, taskPath).status).toBe("in_progress");
  });

  it("blocks task start when Hub before_start preflight fails", () => {
    writeTeamHubConfig(tmp);
    const { binDir, logPath } = installFakeSuncode(tmp, 7);
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Hub task",
      "--slug",
      "hub-task",
      "--hub-requirement-id",
      "REQ-1001",
    ]);
    markTaskHubBound(tmp, taskPath);

    const result = runTaskStart(tmp, taskPath, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(1);
    expect(fs.readFileSync(logPath, "utf-8")).toContain(
      "hub preflight-start",
    );
    expect(readTask(tmp, taskPath).status).toBe("planning");
  });

  it("starts a Hub-bound task only after before_start preflight passes", () => {
    writeTeamHubConfig(tmp);
    const { binDir, logPath } = installFakeSuncode(tmp, 0);
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Hub task",
      "--slug",
      "hub-task",
      "--hub-requirement-id",
      "REQ-1001",
    ]);
    markTaskHubBound(tmp, taskPath);

    const result = runTaskStart(tmp, taskPath, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(logPath, "utf-8")).toContain(
      "hub preflight-start",
    );
    expect(readTask(tmp, taskPath).status).toBe("in_progress");
  });

  it("passes task.json to built-in Hub lifecycle hooks through TASK_JSON_PATH env", () => {
    writeTeamHubConfig(tmp);
    const { binDir, logPath } = installEnvTaskJsonRequiredSuncode(tmp);
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Hub task",
      "--slug",
      "hub-task",
      "--hub-requirement-id",
      "REQ-1001",
    ]);
    markTaskHubBound(tmp, taskPath);

    const result = runTaskStart(tmp, taskPath, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    const log = fs.readFileSync(logPath, "utf-8");
    expect(log).not.toContain("--task-json");
    expect(log).toContain(
      `TASK_JSON_PATH=${path.join(tmp, taskPath, "task.json")}`,
    );
    expect(readTask(tmp, taskPath).status).toBe("in_progress");
  });

  it("queues best-effort Hub sync failures after start", () => {
    writeTeamHubConfig(tmp);
    const { binDir } = installPreflightOkSyncFailSuncode(tmp);
    const taskPath = runTaskCreate(tmp, [
      "create",
      "Hub task",
      "--slug",
      "hub-task",
      "--hub-requirement-id",
      "REQ-1001",
    ]);
    markTaskHubBound(tmp, taskPath);

    const result = runTaskStart(tmp, taskPath, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(readTask(tmp, taskPath).status).toBe("in_progress");
    const queuePath = path.join(
      tmp,
      ".suncode",
      ".runtime",
      "hub-sync-queue.jsonl",
    );
    const entries = fs
      .readFileSync(queuePath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const afterStartEntries = entries.filter(
      (entry) => entry.event === "after_start",
    );
    expect(afterStartEntries).toHaveLength(2);
    expect(afterStartEntries[0]).toMatchObject({
      event: "after_start",
      attempt: 1,
    });
    expect(afterStartEntries.map((entry) => String(entry.command))).toEqual([
      "suncode hub submit-subtasks --best-effort",
      "suncode hub mark-started --best-effort",
    ]);
  });
});
