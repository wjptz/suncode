import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectGrokTemplates,
  configureGrok,
} from "../../src/configurators/grok.js";
import { getAllAgents } from "../../src/templates/grok/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Grok Build templates", () => {
  it("provides Suncode agents with recursion and dispatch guards", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "suncode-check",
      "suncode-implement",
      "suncode-research",
    ]);
    expect(agents.find((agent) => agent.name === "suncode-implement")?.content)
      .toContain("spawn_subagent");
    expect(agents.find((agent) => agent.name === "suncode-check")?.content)
      .toContain("Do not spawn another");
    expect(agents.find((agent) => agent.name === "suncode-research")?.content)
      .toContain("{TASK_DIR}/research/");
  });

  it("collects private skills, flat commands, and pull-based agents", () => {
    const templates = collectGrokTemplates();
    expect(templates.get(".grok/skills/suncode-check/SKILL.md")).toBeDefined();
    expect(templates.get(".grok/commands/suncode-start.md")).toBeDefined();
    expect(templates.has(".grok/commands/suncode/start.md")).toBe(false);
    expect(templates.get(".grok/agents/suncode-implement.md")).toContain(
      "Load Suncode Context First",
    );
    expect(templates.get(".grok/agents/suncode-check.md")).toContain(
      "task.py current --source",
    );
    expect(templates.get(".grok/agents/suncode-research.md")).not.toContain(
      "Load Suncode Context First",
    );
    expect([...templates.keys()].some((key) => key.startsWith(".agents/")))
      .toBe(false);
  });

  it("configureGrok writes exactly the collected template set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-grok-"));
    tempDirs.push(root);
    await configureGrok(root);

    for (const [relativePath, content] of collectGrokTemplates()) {
      expect(fs.readFileSync(path.join(root, relativePath), "utf-8")).toBe(
        content,
      );
    }
    expect(fs.existsSync(path.join(root, ".grok", "hooks"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".grok", "settings.json"))).toBe(
      false,
    );
  });
});
