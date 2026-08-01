import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/suncode/scripts",
);
const STATUSLINE = path.resolve(
  __dirname,
  "../../src/templates/claude/hooks/statusline.py",
);
const SHELL_HOOK = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/inject-shell-session-context.py",
);
const SUBAGENT_HOOK = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/inject-subagent-context.py",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runLegacyStdin(script: string, cwd: string, input: unknown) {
  return spawnSync("python3", [script], {
    cwd,
    input: Buffer.from(JSON.stringify(input), "utf-8"),
    encoding: "utf-8",
    env: { ...process.env, PYTHONIOENCODING: "gbk" },
    timeout: 10_000,
  });
}

describe.skipIf(!hasPython())("Python hook stdin UTF-8 decoding", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-hook-utf8-"));
    fs.mkdirSync(path.join(root, ".suncode", "scripts"), { recursive: true });
    fs.cpSync(TEMPLATE_SCRIPTS, path.join(root, ".suncode", "scripts"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("statusline resolves a UTF-8 Claude session under a legacy locale", () => {
    const sessionId = "中文会话";
    const digest = createHash("sha256")
      .update(sessionId)
      .digest("hex")
      .slice(0, 24);
    const taskDir = path.join(root, ".suncode", "tasks", "utf8-task");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify({ title: "UTF8_TASK", status: "planning", priority: "P2" }),
    );
    const sessions = path.join(root, ".suncode", ".runtime", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, `claude_${digest}.json`),
      JSON.stringify({ current_task: ".suncode/tasks/utf8-task" }),
    );

    const result = runLegacyStdin(STATUSLINE, root, {
      session_id: sessionId,
      model: { display_name: "ASCII" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("UTF8_TASK");
  });

  it("Cursor shell hook preserves a UTF-8 command in its runtime ticket", () => {
    const command = "python3 ./.suncode/scripts/task.py current # 中文命令";
    const result = runLegacyStdin(SHELL_HOOK, root, {
      conversation_id: "conversation-1",
      cwd: root,
      command,
    });
    expect(result.status).toBe(0);

    const ticketDir = path.join(
      root,
      ".suncode",
      ".runtime",
      "cursor-shell",
    );
    const tickets = fs.readdirSync(ticketDir);
    expect(tickets).toHaveLength(1);
    const payload = JSON.parse(
      fs.readFileSync(path.join(ticketDir, tickets[0]), "utf-8"),
    ) as { command: string };
    expect(payload.command).toBe(command);
  });

  it("all shared Python entry hooks install the same UTF-8 stdin guard", () => {
    for (const script of [STATUSLINE, SHELL_HOOK, SUBAGENT_HOOK]) {
      const source = fs.readFileSync(script, "utf-8");
      expect(source).toContain('getattr(sys.stdin, "reconfigure", None)');
      expect(source).toContain('encoding="utf-8", errors="replace"');
      expect(source).toContain("except (OSError, ValueError)");
    }
  });
});
