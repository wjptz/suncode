import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getIdeHooks,
} from "../../src/templates/kiro/index.js";

interface KiroAgentJson {
  name: string;
  resources?: string[];
  hooks?: Record<string, { command: string }[]>;
}

function parseAgent(name: string): KiroAgentJson {
  const agent = getAllAgents().find((a) => a.name === name);
  if (!agent) throw new Error(`kiro agent ${name} is missing`);
  // Source templates carry the {{PYTHON_CMD}} placeholder; JSON is still valid.
  return JSON.parse(agent.content) as KiroAgentJson;
}

describe("kiro templates", () => {
  it("ships the main `suncode` agent plus 3 sub-agents", () => {
    const names = getAllAgents()
      .map((a) => a.name)
      .sort();
    expect(names).toEqual([
      "suncode",
      "suncode-check",
      "suncode-implement",
      "suncode-research",
    ]);
  });

  it("all agent templates are valid JSON", () => {
    for (const agent of getAllAgents()) {
      expect(() => JSON.parse(agent.content), `${agent.name} invalid`).not.toThrow();
    }
  });

  it("main `suncode` agent wires per-turn + session-start hooks and resources", () => {
    const suncode = parseAgent("suncode");

    expect(suncode.hooks?.userPromptSubmit?.[0].command).toContain(
      ".kiro/hooks/inject-workflow-state.py",
    );
    expect(suncode.hooks?.agentSpawn?.[0].command).toContain(
      ".kiro/hooks/session-start.py",
    );
    expect(suncode.resources).toContain("file://.suncode/workflow.md");
    // The main agent must NOT inject sub-agent context (that's the sub-agents' job).
    expect(JSON.stringify(suncode.hooks)).not.toContain(
      "inject-subagent-context.py",
    );
  });

  it("the 3 sub-agents keep agentSpawn → inject-subagent-context.py", () => {
    for (const name of [
      "suncode-implement",
      "suncode-check",
      "suncode-research",
    ]) {
      const agent = parseAgent(name);
      expect(agent.hooks?.agentSpawn?.[0].command).toContain(
        ".kiro/hooks/inject-subagent-context.py",
      );
      // Sub-agents must not carry the main-session per-turn hook.
      expect(agent.hooks?.userPromptSubmit).toBeUndefined();
    }
  });

  it("ships the IDE `.kiro.hook` promptSubmit → runCommand definition", () => {
    const hooks = getIdeHooks();
    expect(hooks.map((h) => h.name)).toContain(
      "suncode-workflow-state.kiro.hook",
    );

    const hook = hooks.find(
      (h) => h.name === "suncode-workflow-state.kiro.hook",
    );
    if (!hook) throw new Error("suncode-workflow-state.kiro.hook is missing");
    const parsed = JSON.parse(hook.content) as {
      version: string;
      enabled: boolean;
      name: string;
      when: { type: string };
      then: { type: string; command: string; timeout: number };
    };
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.enabled).toBe(true);
    expect(parsed.name).toBe("suncode-workflow-state");
    expect(parsed.when.type).toBe("promptSubmit");
    expect(parsed.then.type).toBe("runCommand");
    expect(parsed.then.command).toContain(
      ".kiro/hooks/inject-workflow-state.py",
    );
  });
});
