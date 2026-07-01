import { describe, expect, it } from "vitest";
import { collectPlatformTemplates } from "../../src/configurators/index.js";
import type { AITool } from "../../src/types/ai-tools.js";

describe("engineer OpenCode-compatible templates", () => {
  it("tracks OpenCode-compatible plugin, command, and skill files under .engineer", () => {
    const templates = collectPlatformTemplates("engineer" as AITool);

    expect(templates).toBeInstanceOf(Map);
    expect(templates?.has(".engineer/plugins/inject-subagent-context.js")).toBe(
      true,
    );
    expect(templates?.has(".engineer/plugins/inject-workflow-state.js")).toBe(
      true,
    );
    expect(templates?.has(".engineer/plugins/session-start.js")).toBe(true);
    expect(templates?.has(".engineer/lib/suncode-context.js")).toBe(true);
    expect(templates?.has(".engineer/package.json")).toBe(true);
    expect(templates?.has(".engineer/commands/suncode/start.md")).toBe(true);
    expect(templates?.has(".engineer/skills/suncode-check/SKILL.md")).toBe(
      true,
    );

    for (const [relativePath] of templates ?? []) {
      expect(relativePath.startsWith(".engineer/")).toBe(true);
      expect(relativePath.startsWith(".opencode/")).toBe(false);
      expect(relativePath).not.toMatch(/\\/);
    }
  });
});
