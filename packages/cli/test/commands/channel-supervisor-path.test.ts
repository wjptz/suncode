import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveProviderPath } from "../../src/commands/channel/supervisor.js";

describe("resolveProviderPath", () => {
  let tmpDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-provider-"));
    originalPath = process.env.PATH;
    process.env.PATH = tmpDir;
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTarget(relativeTarget: string, baseDir = tmpDir): string {
    const target = path.join(baseDir, relativeTarget);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
    return target;
  }

  it("resolves direct executable shims without prefix arguments", () => {
    const executable = writeTarget(
      "node_modules\\@anthropic-ai\\claude\\claude.exe",
    );
    fs.writeFileSync(
      path.join(tmpDir, "claude.cmd"),
      '"%dp0%\\node_modules\\@anthropic-ai\\claude\\claude.exe" %*\r\n',
    );
    expect(resolveProviderPath("claude")).toEqual({
      command: executable,
      prefixArgs: [],
    });
  });

  it("runs Node script shims through the current Node executable", () => {
    const script = writeTarget("node_modules\\@openai\\codex\\bin\\codex.js");
    fs.writeFileSync(
      path.join(tmpDir, "codex.cmd"),
      '"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    expect(resolveProviderPath("codex")).toEqual({
      command: process.execPath,
      prefixArgs: [script],
    });
  });

  it("checks project-local node_modules before PATH", () => {
    const projectDir = path.join(tmpDir, "project");
    const binDir = path.join(projectDir, "node_modules", ".bin");
    const script = writeTarget(
      "node_modules\\@openai\\codex\\bin\\codex.js",
      binDir,
    );
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, "codex.cmd"),
      '"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );

    expect(resolveProviderPath("codex", projectDir)).toEqual({
      command: process.execPath,
      prefixArgs: [script],
    });
  });

  it("falls back to the provider name when no target resolves", () => {
    fs.writeFileSync(
      path.join(tmpDir, "codex.cmd"),
      '"%_prog%" "%dp0%\\missing\\codex.js" %*\r\n',
    );
    expect(resolveProviderPath("codex")).toEqual({
      command: "codex",
      prefixArgs: [],
    });
  });
});
