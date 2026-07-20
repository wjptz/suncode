import { describe, expect, it } from "vitest";

import {
  assertSafeName,
  channelDir,
  isSafeName,
} from "../../src/commands/channel/store/paths.js";

describe("CLI channel name path safety", () => {
  it("rejects traversal and path separators", () => {
    for (const name of ["..", ".", "../x", "../../x", "a/b", "a\\b"]) {
      expect(() => assertSafeName(name)).toThrow(/Invalid channel name/);
    }
  });

  it("accepts established ASCII channel names", () => {
    for (const name of ["a", "chat-only", "ch1", "legacy_thread", "a.b"]) {
      expect(isSafeName(name)).toBe(true);
    }
  });

  it("channelDir refuses to resolve outside the store", () => {
    expect(() => channelDir("../../escape")).toThrow(/Invalid channel name/);
  });
});
