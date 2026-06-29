# Suncode CLI Package Identity

## Goal

Rename the runtime package and CLI identity from Trellis/Mindfold to
Suncode/wjptz so users can install `@wjptz/suncode` globally and run the
`suncode` binary.

## Parent Context

- Parent task: `06-29-suncode-full-migration`.
- Phase 0 inventory: `../06-29-suncode-full-migration/research/phase-0-inventory.md`.
- Target package names:
  - CLI package: `@wjptz/suncode`
  - Core package: `@wjptz/suncode-core`
  - CLI binary: `suncode`
- Product boundary decision: do not expose `trellis` or `tl` from the Suncode
  package.

## Requirements

- Rename package identity:
  - `packages/cli/package.json` -> `@wjptz/suncode`
  - `packages/core/package.json` -> `@wjptz/suncode-core`
  - update repository URLs and package descriptions.
- Rename binary identity:
  - expose `suncode`
  - do not expose `trellis`
  - do not expose `tl`
  - update package bin script file naming if appropriate.
- Update imports and dependencies from `@mindfoldhq/trellis-core` to
  `@wjptz/suncode-core`.
- Update workspace scripts, release scripts, preflight scripts, publish
  workflow, and tests that assert package names or binary names.
- Update CLI help/version/upgrade text so current runtime messages say Suncode
  and `suncode`.
- Do not change generated agent interaction names in this task unless required
  by CLI package tests. `/suncode:*` and `suncode-*` generation belongs to the
  agent interactions child task.
- Do not change `.trellis` to `.suncode` in this task. Persistence isolation is
  a later child task.

## Acceptance Criteria

- [ ] `packages/cli/package.json` names the CLI package `@wjptz/suncode`.
- [ ] `packages/core/package.json` names the core package
      `@wjptz/suncode-core`.
- [ ] Workspace scripts and release scripts no longer target
      `@mindfoldhq/trellis` or `@mindfoldhq/trellis-core`.
- [ ] Source imports no longer depend on `@mindfoldhq/trellis-core`.
- [ ] The package exposes `suncode` and does not expose `trellis` or `tl`.
- [ ] CLI user-facing package/binary messages use Suncode.
- [ ] Lockfile and tests are updated consistently.
- [ ] Validation commands pass or any failures are recorded with exact evidence.

## Out of Scope

- Public docs and README copy, except package install snippets needed for tests.
- Agent slash command/skill generation rename.
- `.suncode` persistence isolation.
- docs-site/marketplace submodule URL changes.
- npm publishing.

## Validation

- `pnpm --filter @wjptz/suncode-core test`
- `pnpm --filter @wjptz/suncode test`
- `pnpm --filter @wjptz/suncode typecheck`
- `pnpm test`
- `pnpm build`
- CLI smoke after build:
  - `suncode --version`
  - `suncode --help`
  - `suncode init --help`
  - `suncode update --help`
- Static audit:
  - `rtk rg -n "@mindfoldhq/trellis|@mindfoldhq/trellis-core|\\\"trellis\\\"|\\\"tl\\\"|mindfold-ai/trellis" package.json packages .github`
