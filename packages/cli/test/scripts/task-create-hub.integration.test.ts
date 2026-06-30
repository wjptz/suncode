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

    fs.writeFileSync(
      path.join(tmp, ".suncode", "config.yaml"),
      [
        "hub:",
        "  enabled: true",
        "  mode: team",
        "  projectId: proj_123",
        "  apiBaseUrl: https://hub.example.test",
        "",
      ].join("\n"),
    );

    expect(readHooks(tmp, "after_create")).toContain(
      'suncode hub create-task --task-json "$TASK_JSON_PATH" --best-effort',
    );
    expect(readHooks(tmp, "after_start")).toContain(
      'suncode hub mark-started --task-json "$TASK_JSON_PATH" --best-effort',
    );
    expect(readHooks(tmp, "after_archive")).toContain(
      'suncode hub submit-completion --task-json "$TASK_JSON_PATH" --best-effort',
    );
    expect(readHooks(tmp, "after_finish")).toEqual([]);
  });
});
