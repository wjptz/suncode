import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectKimiTemplates,
  configureKimi,
} from "../../src/configurators/kimi.js";
import { collectPiTemplates } from "../../src/configurators/pi.js";
import { getAllAgents } from "../../src/templates/kimi/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Kimi Code templates", () => {
  it("provides agent prompts for Kimi built-in sub-agents", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "suncode-check",
      "suncode-implement",
      "suncode-research",
    ]);
    expect(agents.find((agent) => agent.name === "suncode-implement")?.content)
      .toContain("built-in `coder`");
    expect(agents.find((agent) => agent.name === "suncode-research")?.content)
      .toContain("built-in `explore`");
  });

  it("collects neutral shared skills and six Kimi-private entry skills", () => {
    const templates = collectKimiTemplates();
    const privateSkills = [...templates.keys()].filter((key) =>
      key.startsWith(".kimi-code/skills/"),
    );
    expect(privateSkills.sort()).toEqual([
      ".kimi-code/skills/suncode-check/SKILL.md",
      ".kimi-code/skills/suncode-continue/SKILL.md",
      ".kimi-code/skills/suncode-finish-work/SKILL.md",
      ".kimi-code/skills/suncode-implement/SKILL.md",
      ".kimi-code/skills/suncode-research/SKILL.md",
      ".kimi-code/skills/suncode-start/SKILL.md",
    ]);
    expect(templates.get(".kimi-code/skills/suncode-implement/SKILL.md"))
      .toContain("Load Suncode Context First");
    expect(templates.get(".kimi-code/skills/suncode-research/SKILL.md"))
      .not.toContain("Load Suncode Context First");
    expect([...templates.keys()].some((key) => key.includes("/hooks/"))).toBe(
      false,
    );
  });

  it("renders shared Agent Skills byte-identically to Pi", () => {
    const kimi = collectKimiTemplates();
    const pi = collectPiTemplates();
    for (const [relativePath, content] of kimi) {
      if (!relativePath.startsWith(".agents/skills/")) continue;
      expect(pi.get(relativePath), relativePath).toBe(content);
    }
  });

  it("configureKimi writes exactly the collected template set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-kimi-"));
    tempDirs.push(root);
    await configureKimi(root);

    for (const [relativePath, content] of collectKimiTemplates()) {
      expect(fs.readFileSync(path.join(root, relativePath), "utf-8")).toBe(
        content,
      );
    }
    expect(fs.existsSync(path.join(root, ".kimi-code", "config.toml"))).toBe(
      false,
    );
  });
});
