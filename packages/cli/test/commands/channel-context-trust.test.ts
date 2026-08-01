import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadAgent } from "../../src/commands/channel/agent-loader.js";
import { assembleContext } from "../../src/commands/channel/context-loader.js";
import {
  parseChannelTrustSection,
  resolveTrustedRoots,
} from "../../src/commands/channel/context-trust.js";

const roots: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function makeProject(): string {
  const root = makeDir("suncode-context-trust-");
  mkdirSync(path.join(root, ".suncode"), { recursive: true });
  return root;
}

function writeConfig(root: string, channelBody: string): void {
  writeFileSync(
    path.join(root, ".suncode", "config.yaml"),
    `channel:\n${channelBody}\n`,
    "utf-8",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("channel trusted context roots", () => {
  it("parses trusted dirs and the Suncode auto-trust switch", () => {
    expect(
      parseChannelTrustSection(`
other: true
channel:
  trusted_context_dirs:
    - ../shared
    - "/absolute/context" # note
  auto_trust_suncode_symlinks: false
next: value
`),
    ).toEqual({
      trustedDirs: ["../shared", "/absolute/context"],
      autoTrustSymlinks: false,
    });
  });

  it("resolves listed roots and skips missing entries with a warning", () => {
    const project = makeProject();
    const external = makeDir("suncode-external-");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeConfig(
      project,
      `  trusted_context_dirs:\n    - ${external}\n    - ./missing`,
    );

    expect(resolveTrustedRoots(project)).toEqual([realpathSync(external)]);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("entry not found or invalid"),
    );
  });

  it("auto-trusts only top-level task and workspace symlinks", () => {
    const project = makeProject();
    const externalTasks = makeDir("suncode-tasks-");
    const externalWorkspace = makeDir("suncode-workspace-");
    symlinkSync(externalTasks, path.join(project, ".suncode", "tasks"), "dir");
    symlinkSync(
      externalWorkspace,
      path.join(project, ".suncode", "workspace"),
      "dir",
    );

    expect(resolveTrustedRoots(project).sort()).toEqual(
      [realpathSync(externalTasks), realpathSync(externalWorkspace)].sort(),
    );
  });

  it("allows disabling top-level Suncode symlink auto-trust", () => {
    const project = makeProject();
    const externalTasks = makeDir("suncode-tasks-disabled-");
    symlinkSync(externalTasks, path.join(project, ".suncode", "tasks"), "dir");
    writeConfig(project, "  auto_trust_suncode_symlinks: false");

    expect(resolveTrustedRoots(project)).toEqual([]);
  });

  it("loads direct and JSONL context under a trusted realpath root", () => {
    const project = makeProject();
    const external = makeDir("suncode-context-");
    const contextFile = path.join(external, "context.md");
    const manifest = path.join(external, "implement.jsonl");
    writeFileSync(contextFile, "trusted context", "utf-8");
    writeFileSync(
      manifest,
      `${JSON.stringify({ file: contextFile, reason: "contract" })}\n`,
      "utf-8",
    );
    writeConfig(project, `  trusted_context_dirs:\n    - ${external}`);
    const trustedRoots = resolveTrustedRoots(project);

    const direct = assembleContext(project, [contextFile], [], trustedRoots);
    const jsonl = assembleContext(project, [], [manifest], trustedRoots);

    expect(direct.prompt).toContain("trusted context");
    expect(jsonl.prompt).toContain("# Reason: contract");
    expect(jsonl.prompt).toContain("trusted context");
  });

  it("rejects planted nested symlinks and sibling-prefix paths", () => {
    const project = makeProject();
    const external = makeDir("suncode-untrusted-");
    mkdirSync(path.join(project, ".suncode", "tasks"), { recursive: true });
    writeFileSync(path.join(external, "secret.md"), "secret", "utf-8");
    symlinkSync(
      path.join(external, "secret.md"),
      path.join(project, ".suncode", "tasks", "planted.md"),
    );
    const sibling = `${project}-sibling`;
    roots.push(sibling);
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "secret.md"), "sibling", "utf-8");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(
      assembleContext(
        project,
        [path.join(project, ".suncode", "tasks", "planted.md")],
        [],
      ).paths,
    ).toEqual([]);
    expect(
      assembleContext(project, [path.join(sibling, "secret.md")], []).paths,
    ).toEqual([]);
  });

  it("keeps the static lstat-realpath-stat-read defense in order", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../src/commands/channel/context-loader.ts"),
      "utf-8",
    );
    const readStart = source.indexOf("function readFileBlock(");
    const readEnd = source.indexOf("function formatBlock(", readStart);
    const readFileBlock = source.slice(readStart, readEnd);
    const operations = [
      "fs.lstatSync(absPath)",
      "fs.realpathSync(absPath)",
      "fs.statSync(real)",
      'fs.readFileSync(real, "utf-8")',
    ];

    let previous = -1;
    for (const operation of operations) {
      const current = readFileBlock.indexOf(operation);
      expect(
        current,
        `missing or out-of-order operation: ${operation}`,
      ).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("loads an agent through an explicitly trusted agents symlink", () => {
    const project = makeProject();
    const external = makeDir("suncode-agents-");
    writeFileSync(
      path.join(external, "research.md"),
      "---\nname: research\nprovider: codex\n---\nTrusted agent",
      "utf-8",
    );
    symlinkSync(external, path.join(project, ".suncode", "agents"), "dir");
    writeConfig(project, `  trusted_context_dirs:\n    - ${external}`);

    const agent = loadAgent("research", project, resolveTrustedRoots(project));
    expect(agent.systemPrompt).toBe("Trusted agent");
    expect(agent.provider).toBe("codex");
  });
});
