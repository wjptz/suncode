/**
 * Integration test for the Kiro output branch of the shared per-turn and
 * session-start hooks.
 *
 * Kiro adds a hook's stdout directly to the conversation context (no JSON
 * envelope). `inject-workflow-state.py` and `session-start.py` therefore have
 * a `platform == "kiro"` branch that prints bare text instead of the
 * Claude-style `{"hookSpecificOutput": ...}` JSON used by every other
 * platform. This test stamps the real templates and runs the actual scripts to
 * verify the branch is plain text for Kiro and that non-Kiro platforms keep the
 * JSON envelope (isolation guard).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/suncode/scripts",
);
const SHARED_HOOKS = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks",
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
  fs.mkdirSync(path.join(tmp, ".suncode", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".suncode", "scripts"), {
    recursive: true,
  });
  // workflow.md with a no_task breadcrumb so the body is deterministic.
  fs.writeFileSync(
    path.join(tmp, ".suncode", "workflow.md"),
    [
      "# Workflow",
      "",
      "## Phase Index",
      "",
      "[workflow-state:no_task]",
      "No active task. Classify the turn before creating a Suncode task.",
      "[/workflow-state:no_task]",
      "",
      "## Phase 1: Plan",
      "",
    ].join("\n"),
  );
}

function setupHubState(tmp: string, home: string): void {
  fs.writeFileSync(
    path.join(tmp, ".suncode", "config.yaml"),
    [
      "hub:",
      "  enabled: true",
      "  projectId: proj_123",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(home, ".suncode", "hub"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".suncode", "hub", "config.json"),
    `${JSON.stringify(
      { version: 1, defaultApiBaseUrl: "https://hub.example.test" },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(home, ".suncode", "hub", "auth.json"),
    `${JSON.stringify(
      {
        version: 1,
        sessions: {
          "https://hub.example.test": {
            developerId: "dev_456",
            displayName: "Dev",
            token: "secret-token",
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
  fs.mkdirSync(path.join(tmp, ".suncode", ".runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".suncode", ".runtime", "hub-state.json"),
    `${JSON.stringify(
      {
        version: 1,
        summary: {
          hub: "on",
          config: "ok",
          login: "ok",
          service: "ok",
          work: "none",
          currentTask: "none",
        },
        work: { availableCount: 0, items: [] },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function writeFakeSuncode(tmp: string, body: string): string {
  const scriptPath = path.join(tmp, "fake-suncode.py");
  fs.writeFileSync(scriptPath, body, "utf-8");
  return scriptPath;
}

function runHook(
  tmp: string,
  script: string,
  platformEnvVar: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; status: number | null } {
  const r = spawnSync(
    "python3",
    [path.join(SHARED_HOOKS, script)],
    {
      cwd: tmp,
      encoding: "utf-8",
      input: JSON.stringify({
        hook_event_name: "userPromptSubmit",
        cwd: tmp,
        session_id: "test-session",
        prompt: "hi",
      }),
      env: { ...process.env, ...extraEnv, [platformEnvVar]: tmp },
    },
  );
  return { stdout: r.stdout, status: r.status };
}

const describeFn = hasPython() ? describe : describe.skip;

describeFn("Kiro hook output branch", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-kiro-hook-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("inject-workflow-state.py emits plain-text breadcrumb for Kiro", () => {
    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "KIRO_PROJECT_DIR",
    );
    expect(status).toBe(0);
    expect(stdout).toContain("<workflow-state>");
    expect(stdout).toContain("<hub-state>");
    expect(stdout).toContain("Status: no_task");
    // Plain text — NOT the Claude-style JSON envelope.
    expect(stdout).not.toContain("hookSpecificOutput");
    expect(stdout).not.toContain("additionalContext");
  });

  it("inject-workflow-state.py keeps JSON envelope for non-Kiro (isolation)", () => {
    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "<workflow-state>",
    );
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "<hub-state>",
    );
  });

  it("inject-workflow-state.py treats YAML enabled: true as Hub enabled", () => {
    const home = path.join(tmp, "home");
    setupHubState(tmp, home);
    const fakeSuncode = writeFakeSuncode(
      tmp,
      [
        "import json",
        "print(json.dumps({",
        '  "summary": {"hub": "on", "config": "ok", "login": "ok", "service": "ok", "work": "none", "currentTask": "none"},',
        '  "project": {"projectId": "proj_123"},',
        '  "work": {"availableCount": 0, "items": []},',
        '  "nextAction": "继续当前本地工作流；没有待选 Hub 需求。"',
        "}, ensure_ascii=False))",
        "",
      ].join("\n"),
    );

    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
      { HOME: home, SUNCODE_CLI: `python3 ${fakeSuncode}` },
    );

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext;
    expect(context).toContain("<hub-state>");
    expect(context).toContain("Hub: on");
    expect(context).toContain("Login: ok");
    expect(context).not.toContain("Hub: off");
    expect(context).not.toContain("secret-token");
  });

  it("inject-workflow-state.py refreshes Hub state through the suncode CLI", () => {
    const home = path.join(tmp, "home");
    setupHubState(tmp, home);
    const fakeSuncode = writeFakeSuncode(
      tmp,
      [
        "import json, sys",
        'assert sys.argv[1:] == ["hub", "state", "--json"], sys.argv',
        "print(json.dumps({",
        '  "summary": {"hub": "on", "config": "ok", "login": "ok", "service": "ok", "work": "available", "currentTask": "none"},',
        '  "project": {"projectId": "proj_123"},',
        '  "work": {"availableCount": 2, "items": []},',
        '  "nextAction": "实时状态显示有可接需求。"',
        "}, ensure_ascii=False))",
        "",
      ].join("\n"),
    );

    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
      {
        HOME: home,
        SUNCODE_CLI: `python3 ${fakeSuncode}`,
      },
    );

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext;
    expect(context).toContain("<hub-state>");
    expect(context).toContain("Source: live");
    expect(context).toContain("Service: ok");
    expect(context).toContain("Work: 2 available requirements");
    expect(context).toContain("实时状态显示有可接需求。");
  });

  it("inject-workflow-state.py treats Hub state refresh failure as unavailable", () => {
    const home = path.join(tmp, "home");
    setupHubState(tmp, home);
    const fakeSuncode = writeFakeSuncode(
      tmp,
      [
        "import sys",
        'assert sys.argv[1:] == ["hub", "state", "--json"], sys.argv',
        "sys.exit(7)",
        "",
      ].join("\n"),
    );

    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
      {
        HOME: home,
        SUNCODE_CLI: `python3 ${fakeSuncode}`,
      },
    );

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext;
    expect(context).toContain("<hub-state>");
    expect(context).toContain("Service: unavailable");
    expect(context).toContain("Hub state refresh failed");
    expect(context).not.toContain("Service: ok");
  });

  it("inject-workflow-state.py treats invalid Hub state JSON as unavailable", () => {
    const home = path.join(tmp, "home");
    setupHubState(tmp, home);
    const fakeSuncode = writeFakeSuncode(
      tmp,
      [
        "print('not-json')",
        "",
      ].join("\n"),
    );

    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
      {
        HOME: home,
        SUNCODE_CLI: `python3 ${fakeSuncode}`,
      },
    );

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext;
    expect(context).toContain("<hub-state>");
    expect(context).toContain("Service: unavailable");
    expect(context).toContain("Hub state refresh failed");
    expect(context).not.toContain("Service: ok");
  });

  it("inject-workflow-state.py treats Hub state refresh timeout as unavailable", () => {
    const home = path.join(tmp, "home");
    setupHubState(tmp, home);
    const fakeSuncode = writeFakeSuncode(
      tmp,
      [
        "import sys, time",
        'assert sys.argv[1:] == ["hub", "state", "--json"], sys.argv',
        "time.sleep(1)",
        "",
      ].join("\n"),
    );

    const { stdout, status } = runHook(
      tmp,
      "inject-workflow-state.py",
      "CLAUDE_PROJECT_DIR",
      {
        HOME: home,
        SUNCODE_CLI: `python3 ${fakeSuncode}`,
        SUNCODE_HUB_STATE_HOOK_TIMEOUT_MS: "50",
      },
    );

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = parsed.hookSpecificOutput?.additionalContext;
    expect(context).toContain("<hub-state>");
    expect(context).toContain("Service: unavailable");
    expect(context).toContain("Hub state refresh timed out");
    expect(context).not.toContain("Service: ok");
  });

  it("session-start.py emits plain-text overview for Kiro", () => {
    const { stdout, status } = runHook(
      tmp,
      "session-start.py",
      "KIRO_PROJECT_DIR",
    );
    expect(status).toBe(0);
    expect(stdout).toContain("<session-context>");
    expect(stdout).not.toContain("hookSpecificOutput");
    expect(stdout).not.toContain("additional_context");
  });

  it("session-start.py keeps JSON envelope for non-Kiro (isolation)", () => {
    const { stdout, status } = runHook(
      tmp,
      "session-start.py",
      "CLAUDE_PROJECT_DIR",
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "<session-context>",
    );
  });
});
