import fs from "node:fs";
import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import {
  getAllAgents,
  getAllCodexSkills,
  getAllHooks,
  getConfigTemplate,
  getHooksConfig,
} from "../templates/codex/index.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveAllAsSkillsNeutral,
  resolveBundledSkills,
  writeSkills,
  writeSharedHooks,
  replacePythonCommandLiterals,
} from "./shared.js";

export interface CodexAgentModelKeys {
  model?: string;
  model_reasoning_effort?: string;
}

export function extractCodexAgentModelKeys(
  existingContent: string,
): CodexAgentModelKeys {
  const result: CodexAgentModelKeys = {};
  let inMultilineString = false;
  for (const rawLine of existingContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (inMultilineString) {
      if (trimmed.includes('"""')) inMultilineString = false;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*=\s*"""/.test(trimmed)) {
      const count = (trimmed.match(/"""/g) ?? []).length;
      if (count < 2) inMultilineString = true;
      continue;
    }
    const match = trimmed.match(
      /^(model|model_reasoning_effort)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/,
    );
    if (!match) continue;
    const key = match[1] as keyof CodexAgentModelKeys;
    result[key] = tomlUnescape(match[2] ?? "");
  }
  return result;
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlUnescape(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function applyCodexAgentModelKeys(
  freshContent: string,
  preserved: CodexAgentModelKeys,
): string {
  const lines: string[] = [];
  if (preserved.model) {
    lines.push(`model = "${tomlEscape(preserved.model)}"`);
  }
  if (preserved.model_reasoning_effort) {
    lines.push(
      `model_reasoning_effort = "${tomlEscape(preserved.model_reasoning_effort)}"`,
    );
  }
  if (lines.length === 0) return freshContent;
  return freshContent.replace(
    /^(sandbox_mode\s*=\s*".*"\n)/m,
    (matched) => `${matched}${lines.join("\n")}\n`,
  );
}

function isCodexAgentTomlPath(filePath: string): boolean {
  return (
    filePath.startsWith(".codex/agents/suncode-") &&
    filePath.endsWith(".toml")
  );
}

export function preserveCodexAgentModelKeys(
  cwd: string,
  files: Map<string, string>,
): void {
  for (const [filePath, freshContent] of files) {
    if (!isCodexAgentTomlPath(filePath)) continue;
    let existingContent: string;
    try {
      existingContent = fs.readFileSync(path.join(cwd, filePath), "utf-8");
    } catch {
      continue;
    }
    files.set(
      filePath,
      applyCodexAgentModelKeys(
        freshContent,
        extractCodexAgentModelKeys(existingContent),
      ),
    );
  }
}

/**
 * Configure Codex by writing:
 * - .agents/skills/ — shared skills from common source
 * - .codex/skills/ — Codex-specific skills (platform-specific templates)
 * - .codex/agents/, hooks/, hooks.json, config.toml — platform-specific
 */
export async function configureCodex(cwd: string): Promise<void> {
  // Shared skills from common source → .agents/skills/
  // Uses the neutral placeholder resolver so the auto-triggered skill templates
  // from `common/skills/` render to the
  // same bytes regardless of which platform writes them — required because
  // Gemini CLI 0.40+ also targets `.agents/skills/` (last-writer-wins is
  // safe when both writers produce identical output).
  const sharedSkillsRoot = path.join(cwd, ".agents", "skills");
  await writeSkills(
    sharedSkillsRoot,
    resolveAllAsSkillsNeutral(AI_TOOLS.codex.templateContext),
    resolveBundledSkills(AI_TOOLS.codex.templateContext),
  );

  const codexRoot = path.join(cwd, ".codex");

  // Codex-specific skills (platform-specific) → .codex/skills/
  const codexSkillsRoot = path.join(codexRoot, "skills");
  ensureDir(codexSkillsRoot);

  for (const skill of getAllCodexSkills()) {
    const skillDir = path.join(codexSkillsRoot, skill.name);
    ensureDir(skillDir);
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      replacePythonCommandLiterals(skill.content),
    );
  }

  // Custom agents → .codex/agents/
  const codexAgentsRoot = path.join(codexRoot, "agents");
  ensureDir(codexAgentsRoot);

  // Native Codex SubagentStart hooks push role-specific context. Each source
  // profile also contains a marker-gated pull fallback for unavailable hooks.
  const agentTomls = new Map<string, string>();
  for (const agent of getAllAgents()) {
    agentTomls.set(
      `.codex/agents/${agent.name}.toml`,
      replacePythonCommandLiterals(agent.content),
    );
  }
  preserveCodexAgentModelKeys(cwd, agentTomls);
  for (const [relativePath, content] of agentTomls) {
    await writeFile(path.join(cwd, relativePath), content);
  }

  // Hooks → .codex/hooks/
  const hooksDir = path.join(codexRoot, "hooks");
  ensureDir(hooksDir);

  // Codex-specific hook files. hooks.json registers UserPromptSubmit for the
  // main session and SubagentStart for role-specific shared context.
  for (const hook of getAllHooks()) {
    await writeFile(
      path.join(hooksDir, hook.name),
      replacePythonCommandLiterals(hook.content),
    );
  }

  // Shared main-session workflow state plus native SubagentStart context.
  await writeSharedHooks(hooksDir, "codex");

  // Hooks config → .codex/hooks.json
  await writeFile(
    path.join(codexRoot, "hooks.json"),
    resolvePlaceholders(getHooksConfig()),
  );

  // NOTE: Codex hooks require `features.hooks = true` in the user's
  // ~/.codex/config.toml (Codex 0.129+). The legacy `features.codex_hooks = true`
  // still works on 0.129+ but emits a deprecation warning; pre-0.129 only
  // accepts `codex_hooks`. Without this flag the hooks.json is ignored and
  // inject-workflow-state.py will never fire. Codex 0.129+ also gates each
  // installed hook behind a one-time `/hooks` review — until the user approves
  // it the workflow breadcrumb won't auto-inject (the bootstrap
  // fallback in inject-workflow-state.py covers this case). Documented in
  // spec/cli/backend/platform-integration.md.
  if (!process.env.VITEST && !process.env.SUNCODE_QUIET) {
    process.stderr.write(
      "⚠️  Codex hooks require `features.hooks = true` in your " +
        "~/.codex/config.toml (Codex 0.129+; older versions: `codex_hooks = true`). " +
        "On Codex 0.129+ also run `/hooks` once to approve the Suncode " +
        "hooks. Without these the Suncode workflow breadcrumb and native " +
        "sub-agent context won't auto-inject (agents retain a pull fallback). " +
        "See Suncode docs for details.\n",
    );
  }

  // Config → .codex/config.toml
  const config = getConfigTemplate();
  await writeFile(
    path.join(codexRoot, config.targetPath),
    replacePythonCommandLiterals(config.content),
  );
}
