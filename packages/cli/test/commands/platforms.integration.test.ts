import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectPlatformTemplates } from "../../src/configurators/index.js";
import { AI_TOOLS, type AITool } from "../../src/types/ai-tools.js";
import { saveHashes } from "../../src/utils/template-hash.js";

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

function markTracked(cwd: string, ...ids: AITool[]): void {
  fs.mkdirSync(path.join(cwd, ".suncode"), { recursive: true });
  saveHashes(
    cwd,
    Object.fromEntries(
      ids.map((id) => {
        const configDir = AI_TOOLS[id].configDir;
        const relativePath = [
          ...(collectPlatformTemplates(id)?.keys() ?? []),
        ].find(
          (entry) => entry === configDir || entry.startsWith(`${configDir}/`),
        );
        if (!relativePath) throw new Error(`missing ${id} ownership template`);
        return [relativePath, "hash"];
      }),
    ),
  );
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
    markTracked(tmpDir, "claude-code", "kimi", "snow");

    const result = runCli(tmpDir, ["platforms", "--json"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      platforms: { id: string; displayName: string; configDir: string }[];
    };
    expect(parsed.platforms).toEqual([
      { id: "claude-code", displayName: "Claude Code", configDir: ".claude" },
      { id: "kimi", displayName: "Kimi Code", configDir: ".kimi-code" },
      { id: "snow", displayName: "Snow CLI", configDir: ".snow/skills" },
    ]);
  });

  it("--json returns an empty list and ignores an unowned .omp directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".omp"), { recursive: true });

    const result = runCli(tmpDir, ["platforms", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ platforms: [] });
  });

  it("human output lists configured platforms", () => {
    markTracked(tmpDir, "grok");

    const result = runCli(tmpDir, ["platforms"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Grok Build");
    expect(result.stdout).toContain(".grok");
  });
});
