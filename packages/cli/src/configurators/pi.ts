import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  applyPullBasedPreludeMarkdown,
  collectSkillTemplates,
  replacePythonCommandLiterals,
  resolveCommands,
  resolveBundledSkills,
  resolvePlaceholders,
  resolveSkillsNeutral,
  writeAgents,
  writeSkills,
} from "./shared.js";
import {
  getAllAgents,
  getExtensionTemplate,
  getSettingsTemplate,
} from "../templates/pi/index.js";

function resolvePiCommands(): ReturnType<typeof resolveCommands> {
  const ctx = AI_TOOLS.pi.templateContext;
  const commands = resolveCommands(ctx);
  if (commands.some((command) => command.name === "start")) return commands;

  // Pi has extension hooks, so the shared command resolver filters `start`.
  // Keep a manual fallback because Pi's `session_start` event cannot mutate
  // model context; the strong startup injection happens later at agent start.
  const start = resolveCommands({ ...ctx, hasHooks: false }).find(
    (command) => command.name === "start",
  );
  return start ? [start, ...commands] : commands;
}

export function collectPiTemplates(): Map<string, string> {
  const files = new Map<string, string>();
  const ctx = AI_TOOLS.pi.templateContext;

  for (const command of resolvePiCommands()) {
    files.set(`.pi/prompts/suncode-${command.name}.md`, command.content);
  }

  // Pi discovers the shared Agent Skills workspace alias natively. Neutral
  // rendering keeps these bytes identical to Codex/Gemini writes and avoids
  // duplicate skill discovery when multiple platforms are configured.
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  for (const agent of applyPullBasedPreludeMarkdown(getAllAgents())) {
    files.set(`.pi/agents/${agent.name}.md`, agent.content);
  }

  files.set(".pi/extensions/suncode/index.ts", getExtensionTemplate());

  const settings = getSettingsTemplate();
  files.set(
    `.pi/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );

  return files;
}

export async function configurePi(cwd: string): Promise<void> {
  const config = AI_TOOLS.pi;
  const ctx = config.templateContext;
  const configRoot = path.join(cwd, config.configDir);

  ensureDir(path.join(configRoot, "prompts"));
  for (const command of resolvePiCommands()) {
    await writeFile(
      path.join(configRoot, "prompts", `suncode-${command.name}.md`),
      command.content,
    );
  }

  // See collectPiTemplates(): Pi shares `.agents/skills/` with other native
  // Agent Skills consumers instead of installing a private duplicate.
  await writeSkills(
    path.join(cwd, ".agents", "skills"),
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  );
  await writeAgents(
    path.join(configRoot, "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );

  ensureDir(path.join(configRoot, "extensions", "suncode"));
  await writeFile(
    path.join(configRoot, "extensions", "suncode", "index.ts"),
    replacePythonCommandLiterals(getExtensionTemplate()),
  );

  const settings = getSettingsTemplate();
  await writeFile(
    path.join(configRoot, settings.targetPath),
    resolvePlaceholders(settings.content),
  );
}
