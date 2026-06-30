# Implementation Plan

## Phase 1: Current Docs Surface

- [x] Update `docs-site/index.mdx`.
- [x] Remove orphaned `docs-site/quickstart.mdx` from the retained site surface.
- [x] Remove orphaned `docs-site/zh/quickstart.mdx` from the retained site surface.
- [x] Update `docs-site/start/install-and-first-task.mdx`.
- [x] Update `docs-site/start/everyday-use.mdx`.
- [x] Update `docs-site/advanced/resources.mdx`.
- [x] Update `docs-site/zh/advanced/resources.mdx`.

## Phase 2: Navigation Reduction

- [x] Update English navigation to keep only `Start Here` and `Advanced`.
- [x] Update Chinese navigation to keep only `开始使用` and `进阶`.
- [x] Remove navbar links to Changelog and Tech Blog.

## Phase 3: Delete Non-Retained Modules

- [x] Delete English non-retained module directories and pages.
- [x] Delete Chinese non-retained module directories and pages under `docs-site/zh/`.
- [x] Delete orphaned root pages that are not part of Start Here or Advanced.

## Phase 4: Image Audit

- [x] Inspect current navigation image references.
- [x] Inspect `docs-site/images/` and `docs-site/logo/`.
- [x] Remove or replace current-path screenshots that show Trellis branding, old package names, old commands, or old GitHub orgs.
- [x] Delete images used only by deleted modules.
- [x] Remove broken image references such as missing dashboard/analytics assets if confirmed.

## Phase 5: Validation

- [x] Run `pnpm lint` in `docs-site`.
- [x] Run targeted residual search for retained-page Trellis install/command references.
- [x] Run `find`/`rg --files` to confirm deleted modules are gone.
- [x] Check `docs-site` git status.
- [x] Commit docs-site changes separately.
- [x] Commit main repo task metadata and docs-site gitlink separately if needed.

## Notes

- Do not use a blind global find-and-replace; delete non-retained modules and edit retained pages intentionally.
- Prefer focused edits to retained pages first.
- `docs-site` is a submodule/independent repo; commit there first before committing the main repo gitlink.
