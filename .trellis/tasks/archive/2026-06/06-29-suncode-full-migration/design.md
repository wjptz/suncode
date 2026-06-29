# Suncode Migration Design

## Problem Statement

This repository is a Trellis fork that should become a complete Suncode
distribution. The migration touches identity, commands, generated agent
artifacts, runtime persistence, docs, template registry, release tooling, and a
clear product boundary from Trellis. Suncode is not an in-place upgrade path for
existing Trellis installations or projects.

## Design Principles

- Prefer staged implementation with a fully independent Suncode target.
- Rename public surfaces before renaming persistence internals.
- Keep historical records intact unless they affect current behavior.
- Treat submodules as separate repositories with their own commits and release
  responsibilities.
- Do not read, migrate, rewrite, or delete Trellis-owned user content from
  Suncode code paths.

## Architecture Boundaries

### Main Repository

Owns CLI runtime, core runtime, generated templates, tests, release scripts, and
submodule pointers.

Key areas:

- `packages/cli/package.json`
- `packages/core/package.json`
- `package.json`
- `packages/cli/src/cli/index.ts`
- `packages/cli/src/types/ai-tools.ts`
- `packages/cli/src/configurators/`
- `packages/cli/src/templates/`
- `packages/cli/src/constants/paths.ts`
- `packages/cli/src/templates/trellis/scripts/common/paths.py`
- `packages/core/src/channel/internal/store/paths.ts`
- `packages/cli/src/utils/template-fetcher.ts`
- `packages/cli/scripts/`
- `.github/`
- `.gitmodules`

### docs-site Repository

Owns public docs, changelog pages, docs navigation, blog posts, examples, and
brand assets. The main repository release guard reads this submodule before
release.

### marketplace Repository

Owns remote workflow/spec/template content fetched by CLI defaults. The main
repository should point default registry URLs at the Suncode marketplace once
that fork exists.

## Migration Phases

### Phase 0: Baseline and Ownership

- Initialize or inspect `docs-site` and `marketplace` submodules.
- Decide target repositories, package scope, docs domain, and release channel.
- Record current Trellis references by category.
- Confirm legal attribution approach.

Output: inventory and ownership decisions.

### Phase 1: Public Brand Surfaces

- Update README, README_CN, CONTRIBUTING, issue templates, package descriptions,
  repository URLs, badges, and current docs links.
- Preserve upstream copyright/license notices and add Suncode fork attribution.
- Do not change runtime behavior yet.

Output: users see Suncode branding in static repo surfaces.

### Phase 2: Package and CLI Identity

- Rename npm packages to `@wjptz/suncode` and `@wjptz/suncode-core`.
- Add primary `suncode` binary.
- Remove `trellis` and `tl`; expose `suncode` as the CLI binary.
- Update CLI help text, version/update/upgrade messages, release scripts,
  workflow package filters, publish workflow, package imports, and lockfile.

Output: users can install and run Suncode CLI independently from Trellis; old
Trellis binaries are not part of the Suncode package target.

### Phase 3: Agent Interaction Names

- Change generated command prefixes from Trellis to Suncode:
  `/suncode:*`, `/suncode-*`, `/skill suncode-*`, and `suncode-*`.
- Update platform-specific generated paths in configurators.
- Update shared skill and command frontmatter naming.
- Update workflow and command templates.
- Remove Trellis-generated command names from the Suncode target.
- Do not rewrite an existing user's Trellis-generated command files as Suncode.

Output: new project integrations generate Suncode commands and skills.

### Phase 4: External Repositories

- Fork or replace `docs-site` with `wjptz/suncode-docs`.
- Fork or replace `marketplace` with `wjptz/suncode-marketplace`.
- Update `.gitmodules` and submodule pointers.
- Update default marketplace URLs in CLI to
  `https://raw.githubusercontent.com/wjptz/suncode-marketplace/main/index.json`
  and `gh:wjptz/suncode-marketplace`.
- Rebrand docs and marketplace content.
- Keep release changelog guard working against the Suncode docs repository.

Docs domain is intentionally unresolved. Until it is chosen, prefer repository
links or clearly temporary docs links over hard-coded permanent domain names.

Output: Suncode releases no longer depend on Mindfold-owned docs or marketplace.

### Phase 5: Persistence and Protocol Isolation

- Introduce `.suncode` as the new default project directory.
- Use `.suncode` for Suncode task, spec, workspace, runtime session state,
  template hashes, config, and managed AGENTS block locations/markers.
- Use `SUNCODE_*` env vars for Suncode runtime identity and hooks.
- Use `~/.suncode/channels` for Suncode channel state.
- Do not read `.trellis` as a legacy Suncode directory.
- Do not convert, move, delete, or rewrite `.trellis` content.

Output: new Suncode projects use Suncode persistence; old Trellis projects
remain Trellis-owned and untouched.

### Phase 6: Cleanup and Release Hardening

- Update tests and fixtures.
- Audit remaining Trellis references and classify them as historical,
  license/attribution, upstream migration history, or bug.
- Run package tests, template tests, init/update smoke tests, docs guard, and
  marketplace fetch smoke tests.
- Write product separation notes and release notes.

Output: Suncode can be released with known breaking behavior.

## Product Isolation Strategy

Decision:

- Do not keep `trellis` or `tl` binaries.
- Do not keep `/trellis:*`, `/trellis-*`, `/skill trellis-*`, or `trellis-*`
  generated interactions.
- Do not read `.trellis` as a legacy runtime directory in Suncode.
- Do not fallback from `SUNCODE_*` to `TRELLIS_*`.
- Do not support `TRELLIS` managed block markers as Suncode-owned markers.
- Do not convert, migrate, overwrite, or delete a user's existing Trellis
  project files.
- Keep Trellis text only where it is legally required, historically accurate, or
  explicitly classified as upstream migration history.

## Risks

- One-shot global replacement can corrupt historical migrations, license text,
  release history, and generated template expectations.
- Users may expect Suncode to upgrade Trellis projects; docs and CLI errors must
  instead make the separation clear.
- Updating default marketplace before the Suncode marketplace is ready can make
  init/update fail.
- Removing original attribution can create license/compliance risk.
- Tests may pass locally while generated templates still contain stale Trellis
  names unless template smoke tests are included.

## Rollback Points

- After Phase 1, revert static docs only.
- After Phase 2, restore old package names if publish readiness fails.
- After Phase 3, regenerate templates from prior command prefixes.
- After Phase 4, restore submodule URLs and marketplace default URL.
- After Phase 5, rollback requires restoring the previous branch or reverting
  the `.suncode` isolation commits. User-owned `.trellis` content should never
  have been modified by Suncode.
