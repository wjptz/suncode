# Suncode Agent Interactions Implementation Plan

## Checklist

- [x] Before editing symbols, inspect current package specs and, if GitNexus
      tools become available, run required impact analysis. GitNexus is not
      available in this checkout at planning time, so local `rg`/tests are the
      fallback.
- [x] Inventory all current generated interaction names with targeted `rg`
      queries over `packages/cli/src/templates`, `packages/cli/src/configurators`,
      `packages/cli/src/types`, and `packages/cli/test`.
- [x] Update `TemplateContext.cmdRefPrefix` and all platform `cmdRefPrefix`
      values to Suncode equivalents while preserving `$` and unprefixed
      platform formats.
- [x] Update shared resolvers in `configurators/shared.ts` so generated
      workflow skill names and frontmatter use `suncode-*`.
- [x] Update bundled skill directories, frontmatter, references, and generated
      cross-links from `trellis-*` to `suncode-*`.
- [x] Rename generated sub-agent template files and frontmatter to
      `suncode-research`, `suncode-implement`, and `suncode-check`.
- [x] Update platform configurators and `collectPlatformTemplates()` path
      builders for Suncode command, prompt, skill, and agent paths.
- [x] Update generated workflow and command templates so routing prose points
      to Suncode interactions.
- [x] Update generated Python/JS helper logic that detects or builds
      interaction names, such as `cli_adapter.py`, OpenCode/Pi helper regexes,
      and hook/plugin references, without renaming deferred persistence
      protocol markers.
- [x] Update tests and fixtures that assert current generated behavior.
- [x] Run static audits and validation commands. Classify any remaining Trellis
      hits before claiming completion.

## Validation Commands

Run from the repository root:

```bash
rtk pnpm --filter @wjptz/suncode test
rtk pnpm --filter @wjptz/suncode typecheck
```

Targeted iteration commands likely useful before the full package run:

```bash
rtk pnpm --dir packages/cli vitest run test/configurators/shared.test.ts test/configurators/platforms.test.ts test/configurators/index.test.ts
rtk pnpm --dir packages/cli vitest run test/templates/codex.test.ts test/templates/cursor.test.ts test/templates/opencode.test.ts test/templates/pi.test.ts test/templates/trellis.test.ts
rtk pnpm --dir packages/cli vitest run test/commands/init.integration.test.ts test/commands/update.integration.test.ts
```

Static audits:

```bash
rtk rg -n "/trellis:|/trellis-|/skill trellis-|\\btrellis-(start|continue|finish-work|before-dev|brainstorm|check|break-loop|update-spec|research|implement|meta|channel|session-insight|spec-bootstrap)\\b" packages/cli/src packages/cli/test --glob '!packages/cli/src/migrations/manifests/**'
rtk rg -n "Trellis command|Trellis workflow|trellis init|trellis update|trellis channel|trellis mem" packages/cli/src/templates packages/cli/test --glob '!packages/cli/src/migrations/manifests/**'
```

Expected remaining hits must be explicitly classified as deferred persistence,
protocol marker, historical test fixture, upstream attribution, or bug.

## Risky Files

- `packages/cli/src/configurators/shared.ts`
- `packages/cli/src/configurators/index.ts`
- `packages/cli/src/types/ai-tools.ts`
- `packages/cli/src/templates/common/`
- `packages/cli/src/templates/*/agents`
- `packages/cli/src/templates/*/droids`
- `packages/cli/src/templates/opencode/lib/trellis-context.js`
- `packages/cli/src/templates/opencode/plugins/`
- `packages/cli/src/templates/pi/`
- `packages/cli/src/templates/trellis/workflow.md`
- `packages/cli/src/templates/trellis/scripts/common/cli_adapter.py`
- `packages/cli/test/configurators/`
- `packages/cli/test/templates/`
- `packages/cli/test/commands/init.integration.test.ts`
- `packages/cli/test/commands/update.integration.test.ts`
- `packages/cli/test/regression.test.ts`
- `marketplace/workflows/`

## Rollback Points

- If path/filename renames become too broad, revert only template/configurator
  path changes and keep shared prefix constants unchanged until the inventory is
  split by platform.
- If update integration tests reveal implicit migration behavior, remove the
  migration-like behavior and keep this task to new generated templates only.
- If remaining Trellis hits are mostly persistence/protocol terms, stop and move
  them to `suncode-persistence-isolation` instead of widening this task.

## Start Gate

Do not run `task.py start` or edit implementation files until the user confirms
this PRD/design/implementation plan.
