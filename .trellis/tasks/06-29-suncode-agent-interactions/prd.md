# Suncode agent interactions

## Goal

New Suncode project integrations should present Suncode-named AI interaction
surfaces instead of Trellis-named ones. This includes generated slash commands,
workflow prompts, skills, bundled skills, sub-agent names, command references,
and agent-facing prose that tells the user or model which Suncode interaction
to invoke.

This task is intentionally narrower than full persistence isolation: generated
projects may still use `.trellis/` files and `TRELLIS_*` protocol markers until
the later `suncode-persistence-isolation` task. Suncode must not convert, move,
delete, or rewrite a user's existing Trellis-generated artifacts.

## User Value

After installing `@wjptz/suncode`, a user who initializes a new project should
see and invoke Suncode interactions such as `/suncode:continue`,
`/suncode-finish-work`, `/skill suncode-check`, and `suncode-*` skills or
sub-agents. They should not need to know or install Trellis to use Suncode.

## Confirmed Facts

- Parent migration Phase 3 requires generated command prefixes and names to move
  to `/suncode:*`, `/suncode-*`, `/skill suncode-*`, and `suncode-*`, while not
  rewriting existing Trellis command files
  (`.trellis/tasks/archive/2026-06/06-29-suncode-full-migration/design.md:88`).
- The inventory classifies slash commands, skills, agents, workflow prompts,
  and generated file names as `interaction` surfaces that must become Suncode
  for new Suncode projects
  (`.trellis/tasks/archive/2026-06/06-29-suncode-full-migration/research/phase-0-inventory.md:70`,
  `.trellis/tasks/archive/2026-06/06-29-suncode-full-migration/research/phase-0-inventory.md:193`).
- Current platform command reference prefixes are typed as `/trellis:`,
  `/trellis-`, `$`, `/`, and `/skill trellis-`
  (`packages/cli/src/types/ai-tools.ts:79`).
- Current shared resolvers and wrappers create `trellis-*` skill and command
  frontmatter names (`packages/cli/src/configurators/shared.ts:262`,
  `packages/cli/src/configurators/shared.ts:361`,
  `packages/cli/src/configurators/shared.ts:392`,
  `packages/cli/src/configurators/shared.ts:426`).
- Current platform collectors write multiple generated paths under
  `trellis` directories or `trellis-*` filenames, including Claude, Cursor,
  Gemini, Devin, Qoder, CodeBuddy, Copilot, Droid, Trae, Codex, and Kiro
  (`packages/cli/src/configurators/index.ts:167`).
- The project spec requires platform references to match each platform's
  interaction format and file format
  (`.trellis/spec/cli/backend/platform-integration.md:786`).
- Init/update template rendering must remain byte-identical between write paths
  and collect paths, and `.agents/skills/` must use the neutral renderer
  (`.trellis/spec/cli/backend/configurator-shared.md:127`).

## Requirements

- R1: Rename generated user-invocable command references by platform:
  `/trellis:*` to `/suncode:*`, `/trellis-*` to `/suncode-*`, and
  `/skill trellis-*` to `/skill suncode-*`, preserving platform-specific
  punctuation and existing non-prefixed formats such as Kilo or Antigravity
  workflows.
- R2: Rename generated workflow skill names from `trellis-*` to `suncode-*`
  in file paths, frontmatter, command palette metadata, tests, and generated
  content.
- R3: Rename generated sub-agent names and files from `trellis-research`,
  `trellis-implement`, and `trellis-check` to `suncode-research`,
  `suncode-implement`, and `suncode-check` across all supported platforms.
- R4: Rename AI-facing bundled skill IDs from `trellis-meta`,
  `trellis-channel`, `trellis-session-insight`, and `trellis-spec-bootstrap`
  to `suncode-meta`, `suncode-channel`, `suncode-session-insight`, and
  `suncode-spec-bootstrap`, including their frontmatter and internal
  cross-references.
- R5: Rebrand generated agent-facing prose that describes the product,
  workflow, or interaction commands from Trellis to Suncode when it is current
  Suncode behavior. Keep literal `.trellis/`, `TRELLIS_*`, managed block
  markers, and clearly historical/legal references out of this task.
- R6: Update helper names, detection regexes, command path builders, update
  template collectors, platform configurators, and tests so init and update
  agree on the new generated Suncode paths.
- R7: Do not add compatibility aliases for Trellis interaction names in Suncode.
  Do not add a migration manifest that converts `trellis-*` user artifacts to
  `suncode-*` user artifacts.
- R8: Do not rewrite, delete, or move existing user Trellis-generated files.
  This task changes what Suncode generates going forward; existing Trellis
  installations remain independent Trellis content.
- R9: Keep selectable workflow templates that are used as current generated
  Suncode workflow content in sync with the Suncode interaction names.

## Acceptance Criteria

- [x] New generated templates and collected platform templates use Suncode
      interaction names for commands, workflow skills, bundled skills, and
      sub-agents.
- [x] Static audit over current generated interaction sources finds no
      unexpected `/trellis:*`, `/trellis-*`, `/skill trellis-*`, or
      AI-facing `trellis-*` command/skill/agent IDs outside explicitly deferred
      persistence/protocol paths, historical records, tests intentionally
      covering legacy behavior, or upstream attribution.
- [x] Init/update tests that assert generated paths and template-hash tracking
      are updated for Suncode names and pass.
- [x] Template tests for affected platform agents, skills, hooks, and command
      references pass.
- [x] CLI package test suite passes:
      `pnpm --filter @wjptz/suncode test`.
- [x] CLI typecheck passes:
      `pnpm --filter @wjptz/suncode typecheck`.
- [x] Built CLI smoke or targeted generated-template smoke verifies at least
      one new-project platform output contains Suncode-named interactions and
      no Trellis-named interaction commands.

## Out of Scope

- Renaming `.trellis/` project state, `.trellis/scripts/`, `.template-hashes`,
  task/spec/workspace paths, channel persistence paths, or Python script module
  names.
- Renaming `TRELLIS_*` environment variables, hook protocol markers,
  `<!-- trellis-hook-injected -->`, managed block markers
  `TRELLIS:START` / `TRELLIS:END`, or XML/HTML block tag names such as
  `<trellis-workflow>`.
- Converting or migrating an installed Trellis project into a Suncode project.
- Adding Trellis compatibility aliases to Suncode.
- Rebranding docs-site, non-workflow marketplace content, release hardening, or
  external repository defaults.
- Rewriting historical migration manifests, changelogs, archive tasks, license,
  or upstream attribution text.

## Open Questions

None. The current plan treats bundled skill IDs and generated sub-agent IDs as
AI-facing interaction surfaces and renames them to Suncode for new Suncode
generations.
