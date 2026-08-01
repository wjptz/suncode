import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  collectSnowTemplates,
  configureSnow,
} from "../../src/configurators/snow.js";
import { getAllAgents, getAllHooks } from "../../src/templates/snow/index.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Snow CLI templates", () => {
  it("registers Snow as a hook-capable Suncode platform", () => {
    expect(AI_TOOLS.snow).toMatchObject({
      configDir: ".snow/skills",
      cliFlag: "snow",
      hasPythonHooks: true,
      templateContext: {
        cmdRefPrefix: "/suncode-",
        agentCapable: true,
        hasHooks: true,
      },
    });
  });

  it("collects namespaced commands, agents, hooks, skills, and guide", () => {
    const files = collectSnowTemplates();
    const paths = [...files.keys()];

    expect(paths).toContain(".snow/SNOW.md");
    expect(paths).toContain(".snow/hooks/onSessionStart.json");
    expect(paths).toContain(".snow/hooks/write-suncode-context.py");
    expect(paths).toContain(".snow/agents/suncode-implement.md");
    expect(paths).toContain(".snow/commands/suncode-continue.json");
    expect(paths).not.toContain(".snow/commands/suncode-start.json");
    expect(paths.some((entry) => entry.includes("trellis"))).toBe(false);
    for (const content of files.values()) {
      expect(content).not.toMatch(/\.trellis\b|TRELLIS_|\btrellis-/);
    }
  });

  it("exposes three Suncode agents and three hook entrypoints", () => {
    expect(getAllAgents().map((agent) => agent.name).sort()).toEqual([
      "suncode-check",
      "suncode-implement",
      "suncode-research",
    ]);
    expect(getAllHooks().map((hook) => hook.targetPath).sort()).toEqual([
      "beforeSubAgentStart.json",
      "onSessionStart.json",
      "onUserMessage.json",
      "write-suncode-context.py",
    ]);
  });

  it("writes exactly the collected template set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-snow-"));
    tempDirs.push(root);

    await configureSnow(root);

    for (const [relativePath, content] of collectSnowTemplates()) {
      expect(fs.readFileSync(path.join(root, relativePath), "utf-8")).toBe(
        content,
      );
    }
    expect(
      fs.existsSync(path.join(root, ".snow", "sub-agents.suncode.json")),
    ).toBe(false);
  });
});
