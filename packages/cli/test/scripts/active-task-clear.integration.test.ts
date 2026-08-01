import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function sessionPath(root: string, key: string): string {
  return path.join(root, ".suncode", ".runtime", "sessions", `${key}.json`);
}

function writeSession(root: string, key: string, task = "task-a"): void {
  const target = sessionPath(root, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({ current_task: `.suncode/tasks/${task}` }) + "\n",
  );
}

function clear(root: string, sessionId: string): ReturnType<typeof spawnSync> {
  const code = `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TEMPLATE_SCRIPTS)})
from common.active_task import clear_active_task
result = clear_active_task(Path(${JSON.stringify(root)}), {"session_id": ${JSON.stringify(sessionId)}}, "codex")
print(json.dumps({"task": result.task_path, "source": result.source_type, "key": result.context_key}))
`;
  return spawnSync("python3", ["-c", code], { cwd: root, encoding: "utf-8" });
}

describe.skipIf(!hasPython())("clear_active_task resolved ownership", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-active-clear-"));
    fs.mkdirSync(path.join(root, ".suncode", "tasks", "task-a"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("deletes only the exact matching session", () => {
    writeSession(root, "codex_one");
    writeSession(root, "codex_two");

    const result = clear(root, "one");
    expect(result.status).toBe(0);
    expect(fs.existsSync(sessionPath(root, "codex_one"))).toBe(false);
    expect(fs.existsSync(sessionPath(root, "codex_two"))).toBe(true);
  });

  it("deletes the resolved sole-session fallback, not the missing request key", () => {
    writeSession(root, "codex_real");

    const result = clear(root, "missing");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: "session-fallback",
      key: "codex_real",
    });
    expect(fs.existsSync(sessionPath(root, "codex_real"))).toBe(false);
  });

  it("deletes nothing when fallback is ambiguous", () => {
    writeSession(root, "codex_one");
    writeSession(root, "codex_two");

    const result = clear(root, "missing");
    expect(result.status).toBe(0);
    expect(fs.existsSync(sessionPath(root, "codex_one"))).toBe(true);
    expect(fs.existsSync(sessionPath(root, "codex_two"))).toBe(true);
  });

  it("preserves a malformed exact session when another session prevents fallback", () => {
    writeSession(root, "codex_other");
    const malformed = sessionPath(root, "codex_bad");
    fs.writeFileSync(malformed, "{not-json", "utf-8");

    const result = clear(root, "bad");
    expect(result.status).toBe(0);
    expect(fs.existsSync(malformed)).toBe(true);
    expect(fs.existsSync(sessionPath(root, "codex_other"))).toBe(true);
  });
});
