# Suncode Migration Implementation Plan

## Execution Model

This task should remain in planning until the user approves the strategy,
especially package/repository naming and the Suncode/Trellis isolation boundary.
Implementation should be split into small commits or child tasks by phase.

## Proposed Child Tasks

1. `suncode-baseline-inventory`
   - Initialize and inspect `docs-site` and `marketplace`.
   - Produce a categorized Trellis reference inventory.
   - Verify the selected target package scope, docs repository, marketplace
     repository, and unresolved docs domain strategy.

2. `suncode-public-branding`
   - Rebrand README, README_CN, CONTRIBUTING, issue templates, badges, package
     descriptions, repository URLs, and attribution text.
   - Preserve upstream license and copyright notices.
   - Validation: static link/reference audit.

3. `suncode-cli-package-identity`
   - Rename CLI/core package names to `@wjptz/suncode` and
     `@wjptz/suncode-core`.
   - Add `suncode` binary.
   - Update package imports, workspace filters, release scripts, publish
     workflow, upgrade text, and lockfile.
   - Validation: typecheck, package tests, CLI help smoke test.

4. `suncode-agent-interactions`
   - Rename generated command prefixes, command file paths, skill names, agent
     names, workflow references, and template content.
   - Remove Trellis-generated artifact names from the Suncode target.
   - Validation: template tests and init/update fixture snapshots.

5. `suncode-docs-marketplace-forks`
   - Fork or replace docs repository with `wjptz/suncode-docs`.
   - Fork or replace marketplace repository with `wjptz/suncode-marketplace`.
   - Update `.gitmodules`, submodule pointers, default marketplace URLs, and
     release docs guard copy.
   - Rebrand docs-site and marketplace content.
   - Validation: docs changelog guard and marketplace fetch smoke test.

6. `suncode-persistence-isolation`
   - Use `.suncode` for Suncode project state.
   - Use `SUNCODE_*` env vars for Suncode runtime identity.
   - Use Suncode managed block markers for Suncode-generated content.
   - Do not read, convert, move, delete, or rewrite `.trellis`, `TRELLIS_*`, or
     Trellis managed block content.
   - Validation: init new project, verify `.trellis` fixtures remain untouched,
     verify no legacy runtime fallbacks, channel path/env tests.

7. `suncode-release-hardening`
   - Audit remaining Trellis references.
   - Classify each as historical, license/attribution, upstream migration
     history, or bug.
   - Update release notes and product separation notes.
   - Run full release preflight.

## Ordered Checklist for the Parent Task

- [x] Confirm product boundary: Suncode and Trellis are independent; Suncode
      must not convert or mutate existing Trellis content.
- [x] Confirm target package names: `@wjptz/suncode` and
      `@wjptz/suncode-core`.
- [x] Confirm docs and marketplace repository names/URLs:
      `wjptz/suncode-docs` and `wjptz/suncode-marketplace`.
- [x] Create child tasks or decide to execute phases inside this task. Created
      `06-29-suncode-public-branding` and
      `06-29-suncode-cli-package-identity`.
- [x] Start with Phase 0 inventory before editing behavior. Inventory recorded
      in `research/phase-0-inventory.md`.
- [ ] After each phase, update this plan with actual validation results.

## Validation Plan

Use the target Suncode package names below. Current source package names are
still Trellis names until implementation begins.

- Static reference audit:
  - `rtk rg -n "Trellis|trellis|TRELLIS|mindfold-ai|trytrellis|@mindfoldhq" .`
- Package/type validation:
  - `pnpm --filter @wjptz/suncode-core test`
  - `pnpm --filter @wjptz/suncode test`
  - `pnpm --filter @wjptz/suncode typecheck`
  - `pnpm test`
- Build validation:
  - `pnpm build`
- CLI smoke tests:
  - `suncode --version`
  - `suncode --help`
  - `suncode init --help`
  - `suncode update --help`
- Project generation smoke tests:
  - initialize a temporary repo with Suncode defaults
  - verify generated commands/skills use Suncode names
  - verify no unintended Trellis references remain in new generated artifacts
- Isolation smoke tests:
  - verify the Suncode package exposes `suncode`, not `trellis` or `tl`
  - verify new generated artifacts use `.suncode`, `SUNCODE_*`, `/suncode:*`,
    and `suncode-*`
  - verify a repo with `.trellis` only is not treated as a Suncode project
  - verify `suncode init` does not modify pre-existing `.trellis` content
  - verify legacy Trellis runtime fallbacks are absent from the target code path
- Docs and marketplace smoke tests:
  - run docs changelog guard against Suncode docs-site
  - fetch default marketplace index
  - resolve at least one workflow template from the Suncode marketplace

## Risky Files and Areas

- `packages/cli/src/constants/paths.ts`
- `packages/cli/src/templates/trellis/scripts/common/paths.py`
- `packages/cli/src/types/ai-tools.ts`
- `packages/cli/src/configurators/`
- `packages/cli/src/templates/`
- `packages/cli/src/migrations/manifests/`
- `packages/cli/src/utils/template-fetcher.ts`
- `packages/core/src/channel/internal/store/paths.ts`
- `packages/cli/scripts/`
- `.github/workflows/`
- `.gitmodules`
- `docs-site`
- `marketplace`

## Do Not Start Implementation Until

- The final plan is reviewed or explicitly approved.
- The target docs and marketplace repository strategy is chosen.
