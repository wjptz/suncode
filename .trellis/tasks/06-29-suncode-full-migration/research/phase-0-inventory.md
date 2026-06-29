# Phase 0 Baseline Inventory

Date: 2026-06-29

## Scope

Phase 0 inspected the main repository plus the initialized `docs-site` and
`marketplace` submodules. This phase is inventory only; it does not change
runtime behavior or product code.

## Submodule State

- `docs-site` was initialized from `https://github.com/mindfold-ai/docs.git`
  and checked out at `dcf265210ba066cddaabb25aeff2598ec815e69c`.
- `marketplace` was initialized from
  `https://github.com/mindfold-ai/marketplace.git` and checked out at
  `2f2e30d1465fe3e2a4ea8cd107dab2a1070ef25b`.
- `.gitmodules` still points to Mindfold-owned repositories:
  `docs-site -> https://github.com/mindfold-ai/docs.git` and
  `marketplace -> https://github.com/mindfold-ai/marketplace.git`.

## Reference Scale

Search pattern:

```text
Trellis|trellis|TRELLIS|@mindfoldhq|mindfold-ai|trytrellis|docs\.trytrellis|\.trellis|/trellis|trellis-
```

Counts exclude lockfiles where noted:

| Area | Files scanned | Files with matches | Notes |
| --- | ---: | ---: | --- |
| Main repo, excluding submodules and `pnpm-lock.yaml` | 601 | 446 | Includes source, templates, tests, scripts, manifests, docs |
| `docs-site`, excluding `pnpm-lock.yaml` | 537 | 315 | Includes EN/ZH docs, changelog, docs nav, embedded marketplace index |
| `marketplace` | 160 | 35 | Concentrated in workflows, Trellis skills, meta references, index |

The migration is broad enough that global replacement is unsafe. Each reference
must be classified by role before editing.

## Main Repository Hotspots

### Package and Publish Identity

- Root scripts still target `@mindfoldhq/trellis` and
  `@mindfoldhq/trellis-core`.
- `packages/cli/package.json` and `packages/core/package.json` still carry
  Mindfold package names and repository URLs.
- Release scripts and GitHub workflows contain package names, release messages,
  docs changelog guards, and preflight checks tied to Trellis.

Target:

- CLI package: `@wjptz/suncode`
- Core package: `@wjptz/suncode-core`
- CLI binary: `suncode`
- Do not expose `trellis` or `tl` from the Suncode package.

### Runtime and Persistence

- Main constants, generated Python scripts, hook scripts, tests, and templates
  still use `.trellis`.
- Channel state defaults still use Trellis-owned names and paths such as
  `TRELLIS_CHANNEL_ROOT`, `TRELLIS_CHANNEL_PROJECT`, and `~/.trellis/channels`.
- Suncode target should use `.suncode`, `SUNCODE_*`, and
  `~/.suncode/channels`.
- Suncode must not read, convert, move, delete, or rewrite a user's existing
  `.trellis` content.

### Agent Interaction Surface

- Platform command prefixes and generated names still use `/trellis:*`,
  `/trellis-*`, `/skill trellis-*`, and `trellis-*`.
- Platform-specific generated paths still include Trellis names, for example
  Claude/Cursor/Gemini/Devin/Qoder/CodeBuddy/Droid/Trae command and skill
  paths.
- Suncode target should generate `/suncode:*`, `/suncode-*`,
  `/skill suncode-*`, and `suncode-*` according to each platform's existing
  naming style.
- Suncode must not rewrite an existing user's Trellis-generated command files.

### Marketplace Fetching

Current default template source remains Mindfold:

- `TEMPLATE_INDEX_URL =
  https://raw.githubusercontent.com/mindfold-ai/marketplace/main/index.json`
- `TEMPLATE_REPO = gh:mindfold-ai/marketplace`
- Current install path mapping still includes `.trellis/spec`.

Target:

- `https://raw.githubusercontent.com/wjptz/suncode-marketplace/main/index.json`
- `gh:wjptz/suncode-marketplace`
- Suncode spec install path should use `.suncode/spec`.

### Historical Data

- Migration manifests and changelogs contain many Trellis references. These are
  historical records and should not be blindly rewritten.
- Current runtime code, templates, generated artifacts, release scripts, and
  public docs are the priority for Suncode rebranding.

## docs-site Hotspots

### Repository and Package Identity

- `docs-site/package.json` uses `name: trellis-docs`, description
  `Trellis Documentation Website - Built with Mintlify`, keyword `trellis`, and
  author `Mindfold`.
- `docs-site/docs.json` uses `name: Trellis Doc`.
- `docs-site/docs.json` excludes `.trellis/**`; Suncode docs should use
  `.suncode/**`.

### Navigation and Slugs

The docs navigation contains Trellis-specific routes and slugs:

- `skills-market/trellis-meta`
- `skills-market/trellis-spec-bootstarp`
- `showcase/trellis-cursor`
- `contribute/trellis`
- `blog/use-k8s-to-know-trellis`

The docs migration needs a route strategy:

- Rename current docs slugs to Suncode where they are current product pages.
- Leave historical changelog slugs/content only if intentionally preserved as
  upstream history.

### Embedded Marketplace Mirror

`docs-site/marketplace/index.json` embeds a small marketplace index. It includes
`trellis-meta` and points paths to `marketplace/skills/trellis-meta`.

This means the docs repository has its own marketplace-like content surface and
must be rebranded independently from the standalone `marketplace` submodule.

### Docs Volume

The docs site has a large amount of EN/ZH content and changelog material. The
rebrand should split:

- current docs pages and navigation
- generated examples and commands
- historical changelog pages
- legal or attribution text

## marketplace Hotspots

### Index

`marketplace/index.json` exposes Trellis-specific skill and workflow entries:

- `trellis-meta`
- `trellis-spec-bootstarp`
- `Native Trellis Workflow`
- TDD workflow description mentions Trellis
- Channel-driven workflow description mentions `trellis channel`

Target entries should use Suncode IDs, names, descriptions, paths, and tags:

- `suncode-meta`
- `suncode-spec-bootstrap` or corrected equivalent
- Suncode workflow names and descriptions
- Suncode channel wording

### Workflows

The marketplace workflow files still describe `.trellis`, `trellis-*`,
`/trellis:*`, and `TRELLIS_*` behavior. They must be updated in sync with the
main repository workflow templates.

### Skills

The marketplace includes Trellis skill directories such as:

- `skills/trellis-meta`
- `skills/trellis-spec-bootstarp`

These are current Suncode product surfaces if published through the Suncode
marketplace, so they should be renamed or replaced rather than treated as
historical docs.

## Classification Rules for Future Edits

Use these categories during implementation:

- `runtime`: code paths that execute or generate user project files. Must become
  Suncode and must not touch Trellis user content.
- `package`: npm names, imports, workspace filters, publish scripts, GitHub
  workflows. Must become Suncode.
- `interaction`: slash commands, skills, agents, workflow prompts, generated
  file names. Must become Suncode for new Suncode projects.
- `remote`: docs and marketplace URLs, submodule URLs, fetch defaults. Must move
  to `wjptz` repositories.
- `docs-current`: current public documentation and navigation. Must become
  Suncode.
- `docs-history`: old changelog or historical migration content. May remain
  Trellis if clearly historical.
- `license-attribution`: upstream copyright, license, and attribution. Preserve
  as required; add Suncode attribution instead of deleting upstream notices.
- `test-fixture`: update when it asserts current behavior; retain only when it
  intentionally covers historical parsing.

## Phase 0 Conclusions

- The selected package and repository naming is feasible:
  `@wjptz/suncode`, `@wjptz/suncode-core`, `wjptz/suncode-docs`, and
  `wjptz/suncode-marketplace`.
- The docs-site and marketplace submodules must be treated as separate
  repositories with their own commits and pointer updates in the main repo.
- Suncode/Trellis product isolation is the central invariant: Suncode creates
  and manages `.suncode` only; it does not convert or mutate `.trellis`.
- The next practical step is to create phase-sized child tasks, starting with
  public branding and package/CLI identity before persistence isolation.
