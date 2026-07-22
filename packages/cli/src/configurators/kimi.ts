/**
 * Kimi Code configurator.
 *
 * Shared workflow skills are rendered neutrally into `.agents/skills/` so
 * Kimi, Codex, Gemini, and Pi cannot overwrite the same file differently.
 * Kimi-specific commands and agent prompts live under `.kimi-code/skills/`.
 */

import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllAgents } from "../templates/kimi/index.js";
import {
  applyPullBasedPreludeMarkdown,
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
  resolveSkillsNeutral,
  writeSkills,
  type AgentContent,
} from "./shared.js";

const KIMI_COMMAND_SKILL_NAMES = new Set([
  "suncode-start",
  "suncode-continue",
  "suncode-finish-work",
]);

function resolveKimiCommandSkills(): ReturnType<typeof resolveAllAsSkills> {
  const ctx = AI_TOOLS.kimi.templateContext;
  return resolveAllAsSkills(ctx).filter((skill) =>
    KIMI_COMMAND_SKILL_NAMES.has(skill.name),
  );
}

function resolveKimiAgentSkills(): AgentContent[] {
  return applyPullBasedPreludeMarkdown(getAllAgents());
}

/** Collect Kimi files for update tracking. Keep in sync with configureKimi. */
export function collectKimiTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.kimi.templateContext;
  const files = new Map<string, string>();

  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  for (const [filePath, content] of collectSkillTemplates(
    ".kimi-code/skills",
    [...resolveKimiCommandSkills(), ...resolveKimiAgentSkills()],
  )) {
    files.set(filePath, content);
  }

  return files;
}

/** Configure Kimi Code during init. */
export async function configureKimi(cwd: string): Promise<void> {
  const config = AI_TOOLS.kimi;
  const ctx = config.templateContext;

  await writeSkills(
    path.join(cwd, ".agents", "skills"),
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  );

  await writeSkills(path.join(cwd, config.configDir, "skills"), [
    ...resolveKimiCommandSkills(),
    ...resolveKimiAgentSkills(),
  ]);
}
