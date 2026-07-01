import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { getOpenCodeTemplatePath } from "../templates/extract.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import { toPosix } from "../utils/posix.js";
import {
  collectSkillTemplates,
  replacePythonCommandLiterals,
  resolveBundledSkills,
  resolveCommands,
  resolveSkills,
} from "./shared.js";

/**
 * Files under packages/cli/src/templates/opencode/ that are NOT user-facing
 * assets (build artifacts, runtime caches, etc.). The template dir has a
 * real package.json that declares the @opencode-ai/plugin dep — that one
 * IS user-facing and must be shipped.
 */
const EXCLUDE_PATTERNS = [
  ".d.ts",
  ".d.ts.map",
  ".js.map",
  "__pycache__",
  "node_modules",
  "bun.lock",
  ".gitignore",
];

function shouldExclude(filename: string): boolean {
  for (const pattern of EXCLUDE_PATTERNS) {
    if (filename.endsWith(pattern) || filename === pattern) {
      return true;
    }
  }
  return false;
}

type OpenCodeCompatibleConfigDir = ".opencode" | ".engineer";

function adaptOpenCodeTemplateContent(
  content: string,
  configDir: OpenCodeCompatibleConfigDir,
): string {
  return replacePythonCommandLiterals(content).replaceAll(
    ".opencode",
    configDir,
  );
}

/**
 * Walk the opencode template directory and produce a `Map<relPath, content>`
 * rooted at an OpenCode-compatible config directory. Shared by init-time writes
 * and update-time hash tracking so the two paths always agree on the exact file
 * set. `commands/` is handled separately (sourced from common template context,
 * not from this directory tree).
 */
function walkOpenCodeTemplateDir(
  configDir: OpenCodeCompatibleConfigDir,
): Map<string, string> {
  const files = new Map<string, string>();
  const sourcePath = getOpenCodeTemplatePath();

  function walk(relDir: string): void {
    const absDir = path.join(sourcePath, relDir);
    for (const entry of readdirSync(absDir)) {
      if (shouldExclude(entry)) continue;
      const absEntry = path.join(absDir, entry);
      const relEntry = relDir ? path.join(relDir, entry) : entry;
      const stat = statSync(absEntry);
      if (stat.isDirectory()) {
        // Skip commands/ — that's sourced from common/ templates, not the
        // opencode/ dir. Including both paths would double-write.
        if (relEntry === "commands") continue;
        walk(relEntry);
      } else {
        const content = readFileSync(absEntry, "utf-8");
        // Map keys are logical paths used as cross-platform hash keys / lookup
        // keys downstream. Always POSIX, regardless of host OS.
        files.set(
          toPosix(path.join(configDir, relEntry)),
          adaptOpenCodeTemplateContent(content, configDir),
        );
      }
    }
  }

  walk("");
  return files;
}

function collectOpenCodeCompatibleTemplates(
  configDir: OpenCodeCompatibleConfigDir,
  ctx = AI_TOOLS.opencode.templateContext,
): Map<string, string> {
  const files = walkOpenCodeTemplateDir(configDir);
  for (const cmd of resolveCommands(ctx)) {
    files.set(`${configDir}/commands/suncode/${cmd.name}.md`, cmd.content);
  }
  for (const [filePath, content] of collectSkillTemplates(
    `${configDir}/skills`,
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  return files;
}

/**
 * Collect all opencode template files that `suncode update` should track.
 *
 * Must stay in sync with `configureOpenCode`: both paths produce the same
 * `Map<relPath, content>`. If they drift, update will spuriously flag newly
 * init'd files as modifications on the next run.
 */
export function collectOpenCodeTemplates(): Map<string, string> {
  return collectOpenCodeCompatibleTemplates(
    ".opencode",
    AI_TOOLS.opencode.templateContext,
  );
}

/**
 * Collect all Engineer template files. Engineer is OpenCode-compatible but uses
 * its own project config root so it can coexist with `.opencode/`.
 */
export function collectEngineerTemplates(): Map<string, string> {
  return collectOpenCodeCompatibleTemplates(
    ".engineer",
    AI_TOOLS.engineer.templateContext,
  );
}

/**
 * Configure OpenCode at init time by writing the same file set enumerated
 * by `collectOpenCodeTemplates`.
 */
export async function configureOpenCode(cwd: string): Promise<void> {
  for (const [relPath, content] of collectOpenCodeTemplates()) {
    const absPath = path.join(cwd, relPath);
    ensureDir(path.dirname(absPath));
    await writeFile(absPath, content);
  }
}

/**
 * Configure Engineer by writing the OpenCode-compatible template set under
 * `.engineer/`.
 */
export async function configureEngineer(cwd: string): Promise<void> {
  for (const [relPath, content] of collectEngineerTemplates()) {
    const absPath = path.join(cwd, relPath);
    ensureDir(path.dirname(absPath));
    await writeFile(absPath, content);
  }
}
