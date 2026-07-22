import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bin/suncode.js",
);

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

describe("suncode platforms", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-platforms-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--json reports the stable configured-platform schema", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".kimi-code"), { recursive: true });

    const result = runCli(tmpDir, ["platforms", "--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      platforms: { id: string; displayName: string; configDir: string }[];
    };
    expect(parsed.platforms).toEqual([
      { id: "claude-code", displayName: "Claude Code", configDir: ".claude" },
      { id: "kimi", displayName: "Kimi Code", configDir: ".kimi-code" },
    ]);
  });

  it("--json returns an empty list and ignores an unowned .omp directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".omp"), { recursive: true });

    const result = runCli(tmpDir, ["platforms", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ platforms: [] });
  });

  it("human output lists configured platforms", () => {
    fs.mkdirSync(path.join(tmpDir, ".grok"), { recursive: true });

    const result = runCli(tmpDir, ["platforms"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Grok Build");
    expect(result.stdout).toContain(".grok");
  });
});
