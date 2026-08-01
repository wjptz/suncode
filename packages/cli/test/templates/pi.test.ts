import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { collectPiTemplates } from "../../src/configurators/pi.js";
import {
  getAllAgents,
  getExtensionTemplate,
  getSettingsTemplate,
} from "../../src/templates/pi/index.js";

interface AgentConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
  fallbackModels: string[];
}

interface PiRunConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
}

interface ContextLimits {
  max_file_bytes: number;
  max_artifact_bytes: number;
  max_total_bytes: number;
}

interface ContextBudgetLike {
  used: number;
}

interface PiExtensionInternals {
  normalizeAgent: (agent: string | undefined) => string;
  isSuncodeAgent: (root: string, agent: string) => boolean;
  parseAgentFM: (content: string) => AgentConfig;
  buildPiArgs: (config: PiRunConfig) => string[];
  resolveRunCfg: (
    input: { model?: string; thinking?: string },
    agentCfg: AgentConfig,
    inheritedThinking?: string,
    inheritedModel?: string,
  ) => PiRunConfig;
  contextModelRef: (ctx?: {
    model?: { provider?: string; id?: string };
  }) => string | undefined;
  readContextInjectionLimits: (root: string) => ContextLimits;
  truncateUtf8: (data: Buffer, cap: number) => Buffer;
  ContextBudget: new (max: number) => ContextBudgetLike;
  materializeFile: (
    root: string,
    file: string,
    reason: string,
    limits: ContextLimits,
    budget: ContextBudgetLike,
  ) => string | null;
  materializeArtifact: (
    root: string,
    file: string,
    label: string,
    reason: string,
    limits: ContextLimits,
    budget: ContextBudgetLike,
  ) => string | null;
  cmdHasSuncodeCtx: (cmd: string) => boolean;
  shellQuote: (v: string) => string;
  suncodeExtension: (pi: {
    registerTool?: (tool: unknown) => void;
    registerShortcut?: (key: string, opts: unknown) => void;
    on?: (
      event: string,
      handler: (event: unknown, ctx?: unknown) => unknown,
    ) => void;
  }) => void;
}

function loadExtensionInternals(cwd = process.cwd()): PiExtensionInternals {
  const source = `${getExtensionTemplate()}

export {
  normalizeAgent,
  isSuncodeAgent,
  parseAgentFM,
  buildPiArgs,
  resolveRunCfg,
  contextModelRef,
  readContextInjectionLimits,
  truncateUtf8,
  ContextBudget,
  materializeFile,
  materializeArtifact,
  cmdHasSuncodeCtx,
  shellQuote,
  suncodeExtension,
};
`;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const require = createRequire(import.meta.url);
  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };
  const sandboxProcess = Object.create(process) as NodeJS.Process;
  Object.defineProperty(sandboxProcess, "cwd", { value: () => cwd });
  Object.defineProperty(sandboxProcess, "env", { value: process.env });
  const sandbox = vm.createContext({
    Buffer,
    console,
    exports: moduleObject.exports,
    module: moduleObject,
    process: sandboxProcess,
    require,
  });
  vm.runInContext(compiled, sandbox);
  return moduleObject.exports as unknown as PiExtensionInternals;
}

function createMinimalSuncodeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "suncode-pi-355-"));
  mkdirSync(join(root, ".pi"), { recursive: true });
  mkdirSync(join(root, ".suncode", "scripts"), { recursive: true });
  writeFileSync(
    join(root, ".suncode", "workflow.md"),
    [
      "[workflow-state:no_task]",
      "No active task. First classify the current turn and ask for task-creation consent before creating any Suncode task.",
      "[/workflow-state:no_task]",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, ".suncode", "scripts", "get_context.py"),
    [
      "#!/usr/bin/env python3",
      "import sys",
      "if '--mode' in sys.argv and 'phase' in sys.argv:",
      "    print('## Phase Index\\nPhase 1: Plan')",
      "else:",
      "    print('SESSION CONTEXT\\nCurrent task: none.')",
      "",
    ].join("\n"),
  );
  return root;
}

describe("pi templates", () => {
  it("provides the three Suncode sub-agent definitions", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "suncode-check",
      "suncode-implement",
      "suncode-research",
    ]);

    for (const agent of agents) {
      expect(agent.content).toContain(`name: ${agent.name}`);
      expect(agent.content).not.toContain("inject-subagent-context.py");
    }
  });

  it("settings rely on Pi's native shared Agent Skills discovery", () => {
    const settings = JSON.parse(getSettingsTemplate().content) as {
      enableSkillCommands?: boolean;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      packages?: unknown[];
    };

    expect(settings.enableSkillCommands).toBe(true);
    expect(settings.extensions).toEqual(["./extensions/suncode/index.ts"]);
    expect(settings.skills).toBeUndefined();
    expect(settings.prompts).toEqual(["./prompts"]);
    expect(settings.packages).toBeUndefined();
  });

  it("writes shared skills to .agents/skills instead of .pi/skills", () => {
    const templates = collectPiTemplates();

    expect(
      templates.get(".agents/skills/suncode-check/SKILL.md"),
    ).toBeDefined();
    for (const key of templates.keys()) {
      expect(key.startsWith(".pi/skills/")).toBe(false);
    }
  });

  it("collects a manual suncode-start prompt for Pi fallback bootstrap", () => {
    const templates = collectPiTemplates();

    expect(templates.get(".pi/prompts/suncode-start.md")).toContain(
      "# Start Session",
    );
    expect(templates.get(".pi/prompts/suncode-continue.md")).toContain(
      "get_context.py --mode phase",
    );
    expect(templates.get(".pi/prompts/suncode-finish-work.md")).toContain(
      "finish-work",
    );
  });

  it("extension registers the suncode_subagent tool with mode+thinking schema", () => {
    const extension = getExtensionTemplate();

    // Tool name + label avoid collision with community subagent packages.
    expect(extension).toContain('name: "suncode_subagent"');
    expect(extension).toContain('label: "Suncode Subagent"');

    // Schema must declare the three dispatch modes and the thinking enum so the LLM
    // can pick a valid mode and override thinking per call.
    expect(extension).toContain('enum: ["single", "parallel", "chain"]');
    expect(extension).toContain(
      'enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"]',
    );

    // Dispatch protocol carries the "Active task: <path>" prefix rule.
    expect(extension).toContain("Active task:");
  });

  it("uses Suncode context limits with UTF-8-safe truncation", () => {
    const {
      readContextInjectionLimits,
      truncateUtf8,
      ContextBudget,
      materializeFile,
    } = loadExtensionInternals();
    const root = mkdtempSync(join(tmpdir(), "suncode-pi-context-"));
    try {
      mkdirSync(join(root, ".suncode"), { recursive: true });
      expect(readContextInjectionLimits(root)).toEqual({
        max_file_bytes: 32768,
        max_artifact_bytes: 65536,
        max_total_bytes: 131072,
      });
      writeFileSync(
        join(root, ".suncode", "config.yaml"),
        [
          "context_injection:",
          "  max_file_bytes: 3",
          "  max_artifact_bytes: 0",
          "  max_total_bytes: 100",
        ].join("\n"),
      );
      const limits = readContextInjectionLimits(root);
      expect(limits).toEqual({
        max_file_bytes: 3,
        max_artifact_bytes: 0,
        max_total_bytes: 100,
      });
      expect(truncateUtf8(Buffer.from("éé"), 3).toString("utf-8")).toBe("é");

      writeFileSync(join(root, "utf8.txt"), "éé");
      const block = materializeFile(
        root,
        "utf8.txt",
        "contract",
        limits,
        new ContextBudget(0),
      );
      expect(block).toContain("é");
      expect(block).not.toContain("�");
      expect(block).toContain("truncated at 3 bytes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("references binary Pi context and shares the total budget", () => {
    const { ContextBudget, materializeFile } = loadExtensionInternals();
    const root = mkdtempSync(join(tmpdir(), "suncode-pi-binary-"));
    try {
      writeFileSync(join(root, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));
      writeFileSync(join(root, "binary-2.bin"), Buffer.from([0x63, 0x00]));
      writeFileSync(join(root, "first.txt"), "a".repeat(30));
      writeFileSync(join(root, "second.txt"), "b".repeat(30));
      const limits = {
        max_file_bytes: 0,
        max_artifact_bytes: 0,
        max_total_bytes: 55,
      };
      const budget = new ContextBudget(80);

      expect(
        materializeFile(root, "binary.bin", "fixture", limits, budget),
      ).toContain("not inlined (binary file)");
      expect(
        materializeFile(root, "binary-2.bin", "fixture", limits, budget),
      ).toBe(
        "[Suncode: total context limit reached — remaining context entries omitted]",
      );
      expect(
        materializeFile(root, "binary.bin", "fixture", limits, budget),
      ).toBeNull();

      const textBudget = new ContextBudget(limits.max_total_bytes);
      expect(
        materializeFile(root, "first.txt", "first", limits, textBudget),
      ).toContain("=== first.txt ===");
      expect(
        materializeFile(root, "second.txt", "second", limits, textBudget),
      ).toContain("total context limit reached");
      expect(
        materializeFile(root, "first.txt", "first", limits, textBudget),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extension wires the Pi events Suncode needs for context flow", () => {
    const extension = getExtensionTemplate();

    // session_start: notify-only welcome
    expect(extension).toContain('pi.on?.("session_start"');
    // input: not used; Suncode must not rewrite submitted user text
    expect(extension).not.toContain('pi.on?.("input"');
    // before_agent_start: stable system prompt + persisted hidden runtime context
    expect(extension).toContain('pi.on?.("before_agent_start"');
    // context: preserves the existing context-key establishment behavior only
    expect(extension).toContain('pi.on?.("context"');
    // tool_call: inject SUNCODE_CONTEXT_ID into bash commands
    expect(extension).toContain('pi.on?.("tool_call"');
    // tool_result: mark failed/cancelled subagent runs as errors
    expect(extension).toContain('pi.on?.("tool_result"');
  });

  it("keeps user input clean while persisting hidden runtime context", () => {
    const root = createMinimalSuncodeRoot();
    const { suncodeExtension } = loadExtensionInternals(root);
    const handlers = new Map<
      string,
      (event: unknown, ctx?: unknown) => unknown
    >();

    suncodeExtension({
      registerTool: vi.fn(),
      registerShortcut: vi.fn(),
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    const ctx = {
      sessionManager: { getSessionId: () => "pi-unit-355" },
      ui: { notify: vi.fn() },
    };
    expect(handlers.has("input")).toBe(false);

    const beforeAgentStart = handlers.get("before_agent_start");
    const first = beforeAgentStart?.(
      {
        type: "before_agent_start",
        prompt: "Adjust service routing",
        systemPrompt: "BASE",
        systemPromptOptions: {},
      },
      ctx,
    ) as {
      systemPrompt: string;
      message: { customType?: string; content?: string; display?: boolean };
    };

    expect(first.systemPrompt).toContain("BASE");
    expect(first.systemPrompt).toContain(
      "Suncode compact SessionStart context",
    );
    expect(first.systemPrompt).toContain("<first-reply-notice>");
    expect(first.systemPrompt).toContain("the user's current request");
    expect(first.systemPrompt).toContain(
      "explicitly established project communication language",
    );
    expect(first.systemPrompt).toContain("Suncode SessionStart ✓");
    expect(first.systemPrompt).toContain(
      "must not alter the language used for the remainder of the response",
    );
    expect(first.systemPrompt).toContain("This notice is one-shot");
    expect(first.systemPrompt).toContain("<suncode-workflow>");
    expect(first.systemPrompt).toContain("Phase 1: Plan");
    expect(first.systemPrompt).toContain("No active Suncode task found");
    expect(first.systemPrompt).not.toContain("<workflow-state>");
    expect(first.systemPrompt).toContain("<session-overview>");
    expect(first.message).toEqual(
      expect.objectContaining({
        customType: "suncode-runtime-context",
        display: false,
      }),
    );
    expect("role" in first.message).toBe(false);
    expect("timestamp" in first.message).toBe(false);
    expect(first.message.content).not.toContain("BASE");
    expect(first.message.content).not.toContain(
      "Suncode compact SessionStart context",
    );
    expect(first.message.content).toContain("<workflow-state>");
    expect(first.message.content).toContain("Status: no_task");
    expect(first.message.content).toContain("<session-overview>");

    const second = beforeAgentStart?.(
      {
        type: "before_agent_start",
        prompt: "Continue",
        systemPrompt: "BASE",
        systemPromptOptions: {},
      },
      ctx,
    ) as {
      systemPrompt: string;
      message?: { customType?: string; content?: string; display?: boolean };
    };

    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(second.message).toBeUndefined();
    expect(handlers.has("context")).toBe(true);
  });

  it("delivers task context changes as persisted messages, not systemPrompt churn", () => {
    const root = createMinimalSuncodeRoot();
    const { suncodeExtension } = loadExtensionInternals(root);
    const handlers = new Map<
      string,
      (event: unknown, ctx?: unknown) => unknown
    >();

    suncodeExtension({
      registerTool: vi.fn(),
      registerShortcut: vi.fn(),
      on(event, handler) {
        handlers.set(event, handler);
      },
    });

    const ctx = {
      sessionManager: { getSessionId: () => "pi-unit-task-update" },
      ui: { notify: vi.fn() },
    };
    const beforeAgentStart = handlers.get("before_agent_start");
    const fire = () =>
      beforeAgentStart?.(
        {
          type: "before_agent_start",
          prompt: "Continue",
          systemPrompt: "BASE",
          systemPromptOptions: {},
        },
        ctx,
      ) as {
        systemPrompt?: string;
        message?: { customType?: string; content?: string; display?: boolean };
      };

    const first = fire();
    expect(first.systemPrompt).toContain("No active Suncode task found");

    const taskDir = join(root, ".suncode", "tasks", "07-07-cache-fix");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "prd.md"), "# PRD\nStable prefix matters.");
    writeFileSync(
      join(taskDir, "task.json"),
      JSON.stringify({ id: "07-07-cache-fix", status: "in_progress" }),
    );
    mkdirSync(join(root, ".suncode", ".runtime", "sessions"), {
      recursive: true,
    });
    writeFileSync(
      join(
        root,
        ".suncode",
        ".runtime",
        "sessions",
        "pi_pi-unit-task-update.json",
      ),
      JSON.stringify({ current_task: "tasks/07-07-cache-fix" }),
    );

    const second = fire();
    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(second.message?.customType).toBe("suncode-runtime-context");
    expect(second.message?.content).toContain("<suncode-task-context-update>");
    expect(second.message?.content).toContain("Stable prefix matters.");

    const third = fire();
    expect(third.systemPrompt).toBe(first.systemPrompt);
    expect(third.message).toBeUndefined();
  });

  it("extension bash tool_call handler prefixes SUNCODE_CONTEXT_ID", () => {
    const extension = getExtensionTemplate();

    // Bash tool calls get SUNCODE_CONTEXT_ID exported in front so spawned
    // python scripts (e.g. task.py current) inherit session identity.
    expect(extension).toContain('ev.toolName === "bash"');
    expect(extension).toContain("export SUNCODE_CONTEXT_ID=");
    expect(extension).toContain("cmdHasSuncodeCtx");
  });

  it("extension tool_result handler marks failed/cancelled subagent runs as errors", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain('ev.toolName === "suncode_subagent"');
    expect(extension).toContain('r.status === "failed"');
    expect(extension).toContain('r.status === "cancelled"');
    expect(extension).toContain("isError: true");
  });

  it("normalizeAgent prefixes bare names with suncode- and leaves prefixed names alone", () => {
    const { normalizeAgent } = loadExtensionInternals();

    expect(normalizeAgent("implement")).toBe("suncode-implement");
    expect(normalizeAgent("check")).toBe("suncode-check");
    expect(normalizeAgent("suncode-research")).toBe("suncode-research");
    expect(normalizeAgent(undefined)).toBe("suncode-implement");
    expect(normalizeAgent("suncode-custom")).toBe("suncode-custom");
  });

  it("isSuncodeAgent gates on a real .pi/agents/*.md definition file", () => {
    const { isSuncodeAgent } = loadExtensionInternals();

    const root = mkdtempSync(join(tmpdir(), "suncode-pi-test-"));
    mkdirSync(join(root, ".pi", "agents"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "agents", "suncode-implement.md"),
      "---\nname: suncode-implement\n---\n",
    );

    expect(isSuncodeAgent(root, "suncode-implement")).toBe(true);
    expect(isSuncodeAgent(root, "not-suncode-foo")).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it("parseAgentFM reads model/thinking/fallbackModels/tools from agent frontmatter", () => {
    const { parseAgentFM } = loadExtensionInternals();

    // Mixed-case tool names in frontmatter must be normalized to lowercase:
    // Pi's built-in tools are lowercase (read, bash, edit, write, grep, find, ls)
    // and pi applies the allowlist without case normalization, so uppercase names
    // would silently fail to enable any tool.
    const cfg = parseAgentFM(`---
name: reviewer
model: anthropic/claude-sonnet-4
thinking: high
tools: Read, Write, Bash, find, Grep
fallbackModels:
  - openai/gpt-5-mini
  - "google/gemini-2.5-pro"
---
# Reviewer
`);

    expect(cfg).toEqual({
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      tools: ["read", "write", "bash", "find", "grep"],
      fallbackModels: ["openai/gpt-5-mini", "google/gemini-2.5-pro"],
    });
    // Belt-and-suspenders: no tool name survives with uppercase letters.
    expect(cfg.tools?.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("buildPiArgs maps PiRunConfig onto Pi CLI args", () => {
    const { buildPiArgs } = loadExtensionInternals();

    // model + thinking → composes "model:thinking" suffix when not already present
    expect(
      buildPiArgs({ model: "anthropic/claude-sonnet-4", thinking: "high" }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "anthropic/claude-sonnet-4:high",
    ]);

    // model already has thinking suffix → passed through unchanged
    expect(
      buildPiArgs({ model: "anthropic/claude-sonnet-4:low", thinking: "high" }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "anthropic/claude-sonnet-4:low",
    ]);

    // thinking-only (no model) → standalone --thinking flag
    expect(buildPiArgs({ thinking: "minimal" })).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--thinking",
      "minimal",
    ]);

    // thinking=off is suppressed
    expect(buildPiArgs({ model: "gpt-5", thinking: "off" })).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      "gpt-5",
    ]);

    expect(buildPiArgs({ model: "openai/gpt-5", thinking: "max" })).toContain(
      "openai/gpt-5:max",
    );

    // tools → --tools flag
    expect(
      buildPiArgs({ tools: ["Read", "Write", "Bash", "find", "Grep"] }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--tools",
      "Read,Write,Bash,find,Grep",
    ]);
  });

  it("resolveRunCfg lets per-call input override agent frontmatter defaults", () => {
    const { resolveRunCfg } = loadExtensionInternals();

    const agentCfg: AgentConfig = {
      model: "anthropic/claude-sonnet-4",
      thinking: "high",
      tools: ["Read", "Write", "Edit", "Bash", "find", "Grep"],
      fallbackModels: [],
    };

    // Per-call model + thinking win over agent config
    expect(
      resolveRunCfg({ model: "openai/gpt-5", thinking: "xhigh" }, agentCfg),
    ).toEqual({
      model: "openai/gpt-5:xhigh",
      thinking: "xhigh",
      tools: agentCfg.tools,
    });

    // No overrides → fall back to agent config
    expect(resolveRunCfg({}, agentCfg)).toEqual({
      model: "anthropic/claude-sonnet-4:high",
      thinking: "high",
      tools: agentCfg.tools,
    });

    // Inherited thinking is the last fallback
    expect(
      resolveRunCfg({}, { model: "gpt-5", fallbackModels: [] }, "medium"),
    ).toEqual({ model: "gpt-5:medium", thinking: "medium" });

    expect(
      resolveRunCfg(
        {},
        { fallbackModels: [] },
        "high",
        "anthropic/claude-parent",
      ),
    ).toEqual({
      model: "anthropic/claude-parent:high",
      thinking: "high",
    });

    expect(
      resolveRunCfg(
        { model: "openai/per-call", thinking: "max" },
        { model: "anthropic/agent", fallbackModels: [] },
        "low",
        "google/parent",
      ),
    ).toEqual({ model: "openai/per-call:max", thinking: "max" });
  });

  it("qualifies the invoking Pi model only when provider and id both exist", () => {
    const { contextModelRef } = loadExtensionInternals();

    expect(
      contextModelRef({ model: { provider: "anthropic", id: "claude" } }),
    ).toBe("anthropic/claude");
    expect(
      contextModelRef({ model: { provider: "anthropic" } }),
    ).toBeUndefined();
    expect(contextModelRef({ model: { id: "claude" } })).toBeUndefined();
  });

  it("cmdHasSuncodeCtx detects already-prefixed bash commands", () => {
    const { cmdHasSuncodeCtx } = loadExtensionInternals();

    expect(cmdHasSuncodeCtx("export SUNCODE_CONTEXT_ID=foo; ls")).toBe(true);
    expect(cmdHasSuncodeCtx("SUNCODE_CONTEXT_ID=foo ls")).toBe(true);
    expect(cmdHasSuncodeCtx("env SUNCODE_CONTEXT_ID=foo ls")).toBe(true);
    expect(cmdHasSuncodeCtx("ls -la")).toBe(false);
    expect(cmdHasSuncodeCtx("")).toBe(false);
  });

  it("shellQuote single-quotes values and escapes embedded single quotes", () => {
    const { shellQuote } = loadExtensionInternals();

    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("with space")).toBe("'with space'");
    expect(shellQuote("with 'quote'")).toBe("'with '\\''quote'\\'''");
  });

  it("extension forwards SUNCODE_CONTEXT_ID into spawned Pi child env", () => {
    const extension = getExtensionTemplate();

    // The child pi process must inherit SUNCODE_CONTEXT_ID so sub-agent
    // task.py current resolves to the same task.
    expect(extension).toContain("SUNCODE_CONTEXT_ID:");
    expect(extension).toContain("...process.env");
  });

  it("passes the invoking provider/model into child run resolution", () => {
    const extension = getExtensionTemplate();
    expect(extension).toContain("const inheritedModel = contextModelRef(ctx)");
    expect(extension).toContain("inheritedThinking,\n        inheritedModel");
  });

  it("extension validates agent definition before spawning a child pi process", () => {
    const extension = getExtensionTemplate();

    // Non-Suncode agent calls must short-circuit and point users to community
    // subagent packages instead of silently spawning a child pi process with
    // a missing agent definition.
    expect(extension).toContain("isSuncodeAgent(root, agentName)");
    expect(extension).toContain("npm:@tintinweb/pi-subagents");
    expect(extension).toContain("npm:pi-subagents");
  });
});
