import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannel } from "../../src/channel/index.js";
import {
  assertSafeName,
  channelDir,
  isSafeName,
  listChannelNamesInProject,
  projectDir,
} from "../../src/channel/internal/store/paths.js";
import { setupChannelTmp, type TmpEnv } from "./setup.js";

describe("channel name path safety", () => {
  let env: TmpEnv;

  beforeEach(() => {
    env = setupChannelTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  it("rejects traversal, separators, and special path segments", () => {
    for (const name of ["..", ".", "../x", "../../x", "a/b", "a\\b"]) {
      expect(() => assertSafeName(name)).toThrow(/Invalid channel name/);
    }
    for (const name of ["a", "chat-only", "legacy_thread", "a.b", "R"]) {
      expect(isSafeName(name)).toBe(true);
    }
  });

  it("channelDir throws before resolving outside the store", () => {
    expect(() => channelDir("../../escape")).toThrow(/Invalid channel name/);
  });

  it("discovery skips invalid legacy directories", async () => {
    await createChannel({ channel: "good-one", by: "main" });
    const bucket = projectDir();
    const legacyDir = path.join(bucket, "坏 名字");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "events.jsonl"), "");

    const names = listChannelNamesInProject(path.basename(bucket));
    expect(names).toContain("good-one");
    expect(names).not.toContain("坏 名字");
    expect(names.every(isSafeName)).toBe(true);
  });

  it("force create cannot delete a directory outside the store", async () => {
    const victim = path.join(env.tmpDir, "victim");
    const marker = path.join(victim, "keep.txt");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(marker, "important");

    await expect(
      createChannel({ channel: "../../victim", by: "main", force: true }),
    ).rejects.toThrow(/Invalid channel name/);
    expect(fs.readFileSync(marker, "utf-8")).toBe("important");
  });
});
