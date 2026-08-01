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

function runProbe(root: string, body: string) {
  return spawnSync(
    "python3",
    [
      "-c",
      `import json, sys\nfrom pathlib import Path\nsys.path.insert(0, ${JSON.stringify(TEMPLATE_SCRIPTS)})\n${body}`,
    ],
    { cwd: root, encoding: "utf-8", timeout: 10_000 },
  );
}

describe.skipIf(!hasPython())("bounded polyrepo Git context", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-polyrepo-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeRepos(count: number): void {
    for (let i = 0; i < count; i += 1) {
      fs.mkdirSync(path.join(root, `repo-${i}`, ".git"), { recursive: true });
    }
  }

  it("collects at most eight automatically discovered child repositories", () => {
    makeRepos(8);
    const result = runProbe(
      root,
      "from common.session_context import _discover_child_git_repos\nprint(json.dumps(_discover_child_git_repos(Path.cwd())))",
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(8);
    expect(result.stderr).toBe("");
  });

  it("fails safe and warns when a ninth child repository is found", () => {
    makeRepos(9);
    const result = runProbe(
      root,
      "from common.session_context import _discover_child_git_repos\nprint(json.dumps(_discover_child_git_repos(Path.cwd())))",
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(result.stderr).toContain("more than 8 child Git repositories");
    expect(result.stderr).toContain(".suncode/config.yaml");
  });

  it("keeps run_git unbounded by default and forwards explicit timeouts", () => {
    const result = runProbe(
      root,
      `import common.git as git_mod
seen = []
class Result:
    returncode = 0
    stdout = "ok"
    stderr = ""
def fake_run(*args, **kwargs):
    seen.append(kwargs.get("timeout"))
    return Result()
git_mod.subprocess.run = fake_run
git_mod.run_git(["status"])
git_mod.run_git(["status"], timeout=0.25)
print(json.dumps(seen))`,
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([null, 0.25]);
  });

  it("uses two-second probes and never reports a failed root status as clean", () => {
    const result = runProbe(
      root,
      `import common.session_context as ctx
seen = []
def fake_git(args, cwd=None, timeout=None):
    seen.append(timeout)
    if args[:2] == ["rev-parse", "--is-inside-work-tree"]:
        return 0, "true\\n", ""
    if args[:2] == ["status", "--porcelain"]:
        return 1, "", "probe failed"
    return 0, "", ""
ctx.run_git = fake_git
info = ctx._collect_root_git_info(Path.cwd())
print(json.dumps({"clean": info["isClean"], "timeouts": seen}))`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      clean: false,
      timeouts: [2, 2, 2, 2, 2],
    });
  });

  it("drops a child repository whose status probe fails", () => {
    fs.mkdirSync(path.join(root, "child", ".git"), { recursive: true });
    const result = runProbe(
      root,
      `import common.session_context as ctx
ctx.run_git = lambda args, cwd=None, timeout=None: (1, "", "failed")
print(json.dumps(ctx._collect_git_repo_info("child", "child", Path.cwd() / "child")))`,
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toBeNull();
  });
});
