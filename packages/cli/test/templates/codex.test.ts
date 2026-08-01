import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllAgents,
  getAllCodexSkills,
  getConfigTemplate,
  getHooksConfig,
} from "../../src/templates/codex/index.js";
import { resolveAllAsSkills } from "../../src/configurators/shared.js";
import {
  applyCodexAgentModelKeys,
  extractCodexAgentModelKeys,
} from "../../src/configurators/codex.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const EXPECTED_AGENT_NAMES = [
  "suncode-check",
  "suncode-implement",
  "suncode-research",
];

// Shared skills are now sourced from common/ via resolveAllAsSkills
describe("codex shared skills (from common source)", () => {
  it("resolves all common templates for codex context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    for (const skill of skills) {
      // Codex uses $ prefix, not /suncode:
      expect(skill.content).not.toContain("/suncode:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });
});

describe("codex getAllAgents", () => {
  it("returns the expected custom agent set", () => {
    const agents = getAllAgents();
    const names = agents.map((agent) => agent.name);
    expect(names).toEqual(EXPECTED_AGENT_NAMES);
  });

  it("each agent has required fields (name, description, developer_instructions)", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content.length).toBeGreaterThan(0);
      expect(agent.content).toContain("name = ");
      expect(agent.content).toContain("description = ");
      expect(agent.content).toContain("developer_instructions = ");
    }
  });

  it("ships commented model override hints without forcing a model", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content).toContain('# model = "gpt-5.6-terra"');
      expect(agent.content).toContain('# model_reasoning_effort = "high"');
      expect(agent.content).not.toMatch(/^model\s*=/m);
    }
  });
});

describe("codex agent model key preservation", () => {
  it("extracts only top-level model keys, not prompt examples", () => {
    const existing = `name = "suncode-implement"
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
developer_instructions = """
model = "do-not-read"
"""
`;

    expect(extractCodexAgentModelKeys(existing)).toEqual({
      model: "gpt-5.6-sol",
      model_reasoning_effort: "xhigh",
    });
  });

  it("reapplies preserved keys immediately after sandbox_mode", () => {
    const fresh = `name = "suncode-check"
sandbox_mode = "workspace-write"
# model = "gpt-5.6-terra"
developer_instructions = """body"""
`;
    const result = applyCodexAgentModelKeys(fresh, {
      model: "custom-model",
      model_reasoning_effort: "max",
    });

    expect(result).toContain(
      'sandbox_mode = "workspace-write"\nmodel = "custom-model"\nmodel_reasoning_effort = "max"\n',
    );
  });
});

describe("codex native sub-agent hooks", () => {
  it("preserves main-session workflow injection and scopes SubagentStart to Suncode roles", () => {
    const config = JSON.parse(getHooksConfig()) as {
      hooks: Record<
        string,
        { matcher?: string; hooks: { command: string }[] }[]
      >;
    };

    expect(config.hooks.UserPromptSubmit).toHaveLength(1);
    expect(config.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      ".codex/hooks/inject-workflow-state.py",
    );

    expect(config.hooks.SubagentStart).toHaveLength(1);
    const subagentStart = config.hooks.SubagentStart?.[0];
    expect(subagentStart?.matcher).toBe(
      "^(?:suncode-implement|suncode-check|suncode-research)$",
    );
    const matcher = new RegExp(subagentStart?.matcher ?? "");
    expect(matcher.test("suncode-implement")).toBe(true);
    expect(matcher.test("suncode-check")).toBe(true);
    expect(matcher.test("suncode-research")).toBe(true);
    expect(matcher.test("suncode-implement-extra")).toBe(false);
    expect(subagentStart?.hooks[0]?.command).toContain(
      ".codex/hooks/inject-subagent-context.py",
    );
  });
});

describe("codex getAllCodexSkills (platform-specific)", () => {
  it("returns empty after parallel removal", () => {
    const skills = getAllCodexSkills();
    expect(skills).toEqual([]);
  });
});

describe("codex getConfigTemplate", () => {
  it("returns project config.toml content", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toContain("project_doc_fallback_filenames");
    expect(config.content).toContain("AGENTS.md");
  });

  // The structured [features.multi_agent_v2] table form is only accepted by
  // Codex CLI 0.131+. On 0.130 and earlier — including the codex CLI bundled
  // in the Codex desktop app — it aborts the whole config load with
  // `data did not match any variant of untagged enum FeatureToml`. Suncode
  // no longer writes the block; this test guards against reintroducing it.
  it("does not write a [features.multi_agent_v2] block (Codex 0.130 compat)", () => {
    const config = getConfigTemplate();
    expect(config.content).not.toMatch(/^\[features\.multi_agent_v2\]/m);
  });

  it("pins agents.max_depth = 1 to keep native dispatch non-recursive", () => {
    const config = getConfigTemplate();
    expect(config.content).toMatch(/^\[agents\]\s*\nmax_depth = 1/m);
  });
});

// =============================================================================
// Issue #234 — Codex sub-agent recursion guard
// =============================================================================
//
// suncode-implement / suncode-check agent toml MUST contain a hard recursion
// guard that tells the sub-agent it is already the dispatched agent and must
// not spawn another suncode-implement / suncode-check sub-agent. Without this,
// SessionStart's "dispatch suncode-implement" guidance leaks into sub-agent
// sessions and causes infinite recursion (see PRD).
describe("codex sub-agent recursion guard (issue #234)", () => {
  for (const name of ["suncode-implement", "suncode-check"] as const) {
    it(`${name}.toml developer_instructions forbids spawning suncode-implement / suncode-check`, () => {
      const tomlPath = path.join(
        repoRoot,
        "packages/cli/src/templates/codex/agents",
        `${name}.toml`,
      );
      const content = fs.readFileSync(tomlPath, "utf-8");
      // Hard prohibition keyword
      expect(content).toMatch(/MUST NOT spawn/i);
      // Mentions both sibling agent kinds explicitly
      expect(content).toContain("suncode-implement");
      expect(content).toContain("suncode-check");
      // Mentions the leakage source so the reader knows why
      expect(content).toMatch(/SessionStart|dispatch.*main session|breadcrumb/i);
    });
  }
});

describe("codex two-channel sub-agent context (native SubagentStart)", () => {
  for (const name of EXPECTED_AGENT_NAMES) {
    it(`${name}.toml uses a marker-gated active-task fallback`, () => {
      const tomlPath = path.join(
        repoRoot,
        "packages/cli/src/templates/codex/agents",
        `${name}.toml`,
      );
      const content = fs.readFileSync(tomlPath, "utf-8");

      expect(content).toContain("<!-- suncode-hook-injected -->");
      expect(content).toContain("Full hook output saved to: <path>");
      expect(content).toContain("Active task: <path>");
      expect(content).toContain("Suncode context manifest: <path>");
      expect(content).toContain("task.py execution context <path>");
      expect(content).toContain("multi_agent = false");
      expect(content.indexOf("Full hook output saved to: <path>")).toBeLessThan(
        content.indexOf("<!-- suncode-hook-injected -->"),
      );
    });
  }

  it("keeps research task resolution isolated from implement/check manifests", () => {
    const researchPath = path.join(
      repoRoot,
      "packages/cli/src/templates/codex/agents/suncode-research.toml",
    );
    const content = fs.readFileSync(researchPath, "utf-8");

    expect(content).toContain("Do not load `implement.jsonl` or `check.jsonl`");
    expect(content).not.toContain(
      "Run `python3 ./.suncode/scripts/task.py current --source`",
    );
  });
});

describe("codex session-start.py compact SessionStart context", () => {
  const hookPath = path.join(
    repoRoot,
    "packages/cli/src/templates/codex/hooks/session-start.py",
  );

  it("uses compact task artifact guidance instead of sub-agent dispatch prose", () => {
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("Suncode compact SessionStart context");
    expect(content).toContain("Task context order for implementation/check");
    expect(content).toContain("design.md if present");
    expect(content).not.toContain("<sub-agent-notice>");
    expect(content).not.toContain("guides (inlined");
    expect(content).not.toContain("Project spec indexes are listed by path below");
  });
});
