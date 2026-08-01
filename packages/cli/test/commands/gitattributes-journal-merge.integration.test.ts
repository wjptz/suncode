import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureGitattributes } from "../../src/configurators/workflow.js";

const dirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "suncode-gitattributes-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Suncode journal merge attributes", () => {
  it("creates the project file with only the append-only journal rule", () => {
    const cwd = makeProject();
    ensureGitattributes(cwd);

    const target = path.join(cwd, ".gitattributes");
    expect(existsSync(target)).toBe(true);
    const content = readFileSync(target, "utf-8");
    expect(content).toContain(".suncode/workspace/*/journal-*.md merge=union");
    expect(content).not.toMatch(/^\.suncode\/workspace\/\*\/index\.md/m);
  });

  it("appends without replacing user-owned attributes", () => {
    const cwd = makeProject();
    const target = path.join(cwd, ".gitattributes");
    writeFileSync(target, "*.png binary\n", "utf-8");

    ensureGitattributes(cwd);

    expect(readFileSync(target, "utf-8")).toMatch(
      /^\*\.png binary\n\n# Suncode:/,
    );
  });

  it("does not duplicate an existing whitespace-variant journal rule", () => {
    const cwd = makeProject();
    const target = path.join(cwd, ".gitattributes");
    const original = ".suncode/workspace/*/journal-*.md    merge=union\n";
    writeFileSync(target, original, "utf-8");

    ensureGitattributes(cwd);
    ensureGitattributes(cwd);

    expect(readFileSync(target, "utf-8")).toBe(original);
  });

  it("does not confuse a Trellis journal rule with Suncode ownership", () => {
    const cwd = makeProject();
    const target = path.join(cwd, ".gitattributes");
    const trellisRule = ".trellis/workspace/*/journal-*.md merge=union\n";
    writeFileSync(target, trellisRule, "utf-8");

    ensureGitattributes(cwd);

    const content = readFileSync(target, "utf-8");
    expect(content).toContain(trellisRule);
    expect(content).toContain(".suncode/workspace/*/journal-*.md merge=union");
  });
});
