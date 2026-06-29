# Suncode persistence isolation implementation plan

## Order

1. Update central path and env constants.
   - Change `DIR_NAMES.WORKFLOW` to `.suncode`.
   - Rename `TRELLIS_*` runtime env var literals to `SUNCODE_*` in current Suncode code paths.
   - Update comments and error messages that are generated or user-visible.

2. Update generated workflow scripts and hooks.
   - Change Python constants under workflow script templates to `.suncode`.
   - Change session context, active task, shell bridge, hook disable flags, context id persistence, and protocol wrappers.
   - Rename injected marker text to `<!-- suncode-hook-injected -->`.

3. Update platform templates and configurators.
   - Update commands/prompts/agents for Claude, Codex, Cursor, Gemini, OpenCode, Pi, Kiro, Qoder, Copilot, CodeBuddy, Droid, Trae, Reasonix, and ZCode.
   - Keep Suncode agent/skill names from the previous task.

4. Update bundled skills and generated local docs.
   - Replace current-runtime `.trellis/*` instructions with `.suncode/*`.
   - Replace current-runtime Trellis terminology with Suncode terminology.
   - Keep explicit historical/fork references where appropriate.

5. Update channel core.
   - Change default channel root to `~/.suncode/channels`.
   - Rename channel env overrides to `SUNCODE_CHANNEL_ROOT` and `SUNCODE_CHANNEL_PROJECT`.
   - Update worker guard env names in CLI channel code.

6. Update tests.
   - Start with path constants, init integration, hook template, channel core tests.
   - Then run broader CLI test suite and fix remaining runtime assertions.

7. Audit generated runtime surfaces.
   - Grep runtime sources and templates for non-historical `trellis`, `Trellis`, `.trellis`, `TRELLIS_`, `trellis-workflow`, and `trellis-hook`.
   - Classify each leftover as fixed or intentionally historical.

8. Verify and commit.

## Validation Commands

```bash
pnpm -C packages/core test
pnpm -C packages/cli exec vitest run --reporter=dot
pnpm -C packages/cli run typecheck
pnpm -C packages/cli run build
git diff --check
```

Use `rtk` prefix in this WSL `/home/*` workspace when running these commands from Codex.

## Focused Grep Audit

Run after implementation:

```bash
rg -n "trellis|Trellis|\\.trellis|TRELLIS_|trellis-workflow|trellis-hook" \
  packages/cli/src packages/cli/test packages/core/src packages/core/test \
  --glob '!**/migrations/manifests/**'
```

Expected result: no current Suncode runtime leftovers. Remaining hits must be documented as historical parser or migration coverage.

## Review Gate

Before implementation starts, review the PRD and design against the user's decisions:

- no compatibility aliases
- no `.trellis` to `.suncode` migration
- Suncode and Trellis can coexist independently
- generated Suncode user experience should not show Trellis names in normal use
