# Plan staged Suncode migration

## Goal

Migrate this Trellis fork into a fully branded Suncode distribution in staged,
reviewable steps. The final state should present, install, run, document,
generate agent interactions, fetch templates, and persist new-project workflow
state as Suncode. Suncode and Trellis should be treated as two independent
products: installing or running Suncode must not convert, migrate, or rewrite a
user's existing Trellis installation or `.trellis` project content.

## User Value

- Users should be able to discover the project as Suncode, install a Suncode
  CLI, run Suncode commands, and see Suncode docs and generated agent commands.
- Maintainers should be able to release Suncode without accidentally depending
  on Mindfold-owned docs, marketplace, package names, command names, or release
  copy.
- Users should be able to install Suncode alongside Trellis without Suncode
  taking ownership of Trellis files, commands, environment variables, or
  generated agent artifacts.

## Requirements

### Confirmed Facts

- The main repository is already a fork target: `origin` points at
  `https://github.com/Cucgua/suncode.git`, while `upstream` points at
  `https://github.com/mindfold-ai/Trellis.git`.
- `docs-site` and `marketplace` are Git submodules, not workspace packages:
  `.gitmodules` maps `docs-site` to `https://github.com/mindfold-ai/docs.git`
  and `marketplace` to `https://github.com/mindfold-ai/marketplace.git`.
- The workspace only includes `packages/*`; `docs-site` and `marketplace` are
  outside the pnpm workspace package set.
- Current CLI package identity is still Trellis:
  `packages/cli/package.json` uses `@mindfoldhq/trellis`, and
  `packages/core/package.json` uses `@mindfoldhq/trellis-core`.
- Current CLI binaries are `trellis` and `tl`; the command program name is still
  `trellis`.
- Agent command generation still emits Trellis names such as `/trellis:*`,
  `/trellis-*`, `/skill trellis-*`, and `trellis-*` skill names.
- Internal project state still uses `.trellis`, managed block markers still use
  `TRELLIS`, and channel runtime defaults still use Trellis environment
  variables and `~/.trellis/channels`.
- Default remote template fetching still uses
  `https://raw.githubusercontent.com/mindfold-ai/marketplace/main/index.json`
  and `gh:mindfold-ai/marketplace`.
- Release guards expect changelog files in the `docs-site` submodule before
  beta, rc, or promote releases.
- The checked-out submodules are not initialized in this workspace yet, so
  their internal content has not been audited in this task.

### Functional Requirements

- FR1: Define a staged migration path from Trellis to Suncode that avoids broad,
  unsafe global replacement.
- FR2: Rebrand public project surfaces: README files, contribution docs, issue
  templates, badges, docs links, package descriptions, and repository URLs.
- FR3: Rename package and CLI identity to Suncode, including npm package names,
  workspace filters, imports, binary names, help text, upgrade guidance, release
  scripts, and publish workflow.
- FR4: Rename generated agent interaction surfaces to Suncode for supported
  platforms, including slash commands, command files, skill names, agent names,
  workflow references, and template-generated docs.
- FR5: Fork or otherwise replace the external `docs-site` and `marketplace`
  dependencies so official Suncode docs and templates do not depend on
  Mindfold-owned repositories.
- FR6: Define Suncode's own persistence/protocol surface, including `.suncode`,
  `SUNCODE_*`, Suncode managed block markers, Suncode channel paths, generated
  templates, Python scripts, TypeScript constants, and tests.
- FR7: Preserve license and attribution obligations. Do not delete original
  upstream copyright/license notices when rebranding.
- FR8: Keep Trellis and Suncode independent. Suncode must not expose `trellis`
  or `tl` binaries, must not generate `/trellis:*` or `trellis-*` interactions,
  and must not read, convert, rewrite, or delete `.trellis`, `TRELLIS_*`, or
  Trellis managed block markers.
- FR9: Update tests and release checks so they validate Suncode behavior and do
  not hide leftover Trellis dependencies.

### Non-Functional Requirements

- NFR1: The migration must be split into small, reviewable commits or tasks.
- NFR2: Each stage must have targeted validation before proceeding.
- NFR3: Historical migration manifests may remain Trellis-branded when they are
  historical records, but current Suncode runtime behavior must not depend on
  Trellis-owned paths or variables.
- NFR4: New user-facing output should consistently say Suncode unless it is
  explicitly documenting that Trellis is a separate, unmanaged product line.
- NFR5: Breaking behavior must be tested and documented. Remaining Trellis
  references must be classified as historical attribution, license text,
  upstream migration history, or a bug.

## Acceptance Criteria

- [ ] A staged migration plan exists with clear phase boundaries, risks,
      validation commands, and rollback points.
- [ ] The plan identifies which work stays in the main repository and which work
      belongs in the `docs-site` and `marketplace` repositories.
- [ ] The plan states that Suncode and Trellis are independent products, not an
      upgrade path where Suncode converts Trellis content.
- [ ] The plan includes a release strategy for package names, docs changelog
      requirements, and marketplace template source changes.
- [ ] The plan includes a concrete Suncode persistence approach using
      `.suncode`, `SUNCODE_*`, and Suncode markers, with explicit tests that
      `.trellis` content is not converted or modified.
- [ ] The plan includes validation for package build/test, template generation,
      init/update smoke tests, docs changelog guard, and marketplace template
      fetching.
- [ ] User reviews and approves the final planning artifacts before code
      implementation starts.

## Out of Scope

- Immediate implementation of the rename in this planning step.
- Publishing npm packages, pushing GitHub repositories, or changing remote
  repositories without explicit user approval.
- Removing AGPL-3.0 license text or original upstream attribution.
- Rewriting all historical Trellis release manifests solely for cosmetic
  branding.

## Notes

- This task is repo-wide even though Trellis assigned the default package as
  `cli`.
- Evidence gathered so far is static repository inspection only. No build,
  tests, or submodule checkout validation has been run.

## Decisions

- D1: Treat Suncode and Trellis as independent products. Suncode should not keep
  `trellis` or `tl` binaries and should not generate `/trellis:*` or
  `trellis-*` interactions. Suncode should use its own `.suncode`, `SUNCODE_*`,
  and managed block markers, but must leave existing `.trellis`, `TRELLIS_*`,
  and Trellis managed content untouched rather than converting it.

## Open Questions

None blocking.

## Package Naming

- Target global install command: `npm install -g @wjptz/suncode`.
- Target CLI package name: `@wjptz/suncode`.
- Target core package name: `@wjptz/suncode-core`.
- Target CLI binary: `suncode`.
- npm registry check on 2026-06-29 returned `E404` for both
  `@wjptz/suncode` and `@wjptz/suncode-core`, so these exact package names are
  not currently published in the public npm registry. Publishing still requires
  ownership or publish permissions for the `@wjptz` npm scope.

## External Repository Naming

- Target docs repository: `wjptz/suncode-docs`.
- Target marketplace repository: `wjptz/suncode-marketplace`.
- Target docs domain: not fixed yet. Until a domain is chosen, implementation
  should avoid baking a permanent docs domain into generated runtime behavior;
  README/docs links can use repository links or a clearly marked future docs
  placeholder.
- Target marketplace index URL:
  `https://raw.githubusercontent.com/wjptz/suncode-marketplace/main/index.json`.
- Target marketplace source shortcut: `gh:wjptz/suncode-marketplace`.
