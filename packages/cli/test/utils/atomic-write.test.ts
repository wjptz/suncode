import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "../../src/utils/atomic-write.js";

describe("writeFileAtomic", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-atomic-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes new content", () => {
    const filePath = path.join(dir, "state.json");
    writeFileAtomic(filePath, '{"ok":true}');
    expect(fs.readFileSync(filePath, "utf-8")).toBe('{"ok":true}');
  });

  it("overwrites without leaving a temp file", () => {
    const filePath = path.join(dir, "state.json");
    writeFileAtomic(filePath, "old");
    writeFileAtomic(filePath, "new");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });
});
