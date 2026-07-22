/**
 * Grok Build configurator.
 *
 * Grok is a pull-based platform: Suncode installs private skills, flat
 * commands, and agent definitions, but no project-level hooks.
 */

import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllAgents } from "../templates/grok/index.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  applyPullBasedPreludeMarkdown,
  collectSkillTemplates,
  resolveBundledSkills,
  resolveCommands,
  resolveSkills,
  writeAgents,
  writeSkills,
} from "./shared.js";

/** Collect Grok files for update tracking. Keep in sync with configureGrok. */
export function collectGrokTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.grok.templateContext;
  const files = new Map<string, string>();

  for (const [filePath, content] of collectSkillTemplates(
    ".grok/skills",
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  for (const command of resolveCommands(ctx)) {
    files.set(`.grok/commands/suncode-${command.name}.md`, command.content);
  }

  for (const agent of applyPullBasedPreludeMarkdown(getAllAgents())) {
    files.set(`.grok/agents/${agent.name}.md`, agent.content);
  }

  return files;
}

/** Configure Grok Build during init. */
export async function configureGrok(cwd: string): Promise<void> {
  const ctx = AI_TOOLS.grok.templateContext;

  await writeSkills(
    path.join(cwd, ".grok", "skills"),
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  );

  const commandsDir = path.join(cwd, ".grok", "commands");
  ensureDir(commandsDir);
  for (const command of resolveCommands(ctx)) {
    await writeFile(
      path.join(commandsDir, `suncode-${command.name}.md`),
      command.content,
    );
  }

  await writeAgents(
    path.join(cwd, ".grok", "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );
}
