# Public Branding Implementation Plan

## Checklist

- [x] Review Phase 0 inventory before editing.
- [x] Update main repo README and contribution docs.
- [x] Update `.github` issue/community links.
- [x] Update docs-site metadata and current navigation names.
- [x] Update marketplace README and current visible product labels.
- [x] Preserve upstream license/attribution.
- [x] Create target public GitHub repositories after user confirmation.
- [x] Update main repository remotes and submodule remotes.
- [x] Update `.gitmodules` to point at Suncode-owned submodule repositories.
- [x] Run static branding audit.
- [x] Record remaining references and classify them in
      `research/remaining-reference-audit.md`.

## Validation Results

- Static branding audit executed. Remaining references are classified in
  `research/remaining-reference-audit.md`.
- JSON parse check passed for docs-site and marketplace JSON files.
- Created public GitHub repositories:
  - `https://github.com/wjptz/suncode`
  - `https://github.com/wjptz/suncode-docs`
  - `https://github.com/wjptz/suncode-marketplace`
- Local remote verification:
  - Main repo `origin` now points to `https://github.com/wjptz/suncode.git`.
  - Main repo previous `origin` is preserved as `cucgua`.
  - Main repo `upstream` remains `https://github.com/mindfold-ai/Trellis.git`.
  - `docs-site` `origin` now points to
    `https://github.com/wjptz/suncode-docs.git`.
  - `docs-site` previous `origin` is preserved as `upstream`.
  - `marketplace` `origin` now points to
    `https://github.com/wjptz/suncode-marketplace.git`.
  - `marketplace` previous `origin` is preserved as `upstream`.
- `git ls-remote --heads origin` exited successfully for the main repo,
  `docs-site`, and `marketplace`. The repos are currently empty, so no heads
  were printed.
- Full docs lint/build not run; this task changed docs/metadata only, and
  package/runtime validation belongs to later child tasks.

## Likely Files

- `README.md`
- `README_CN.md`
- `CONTRIBUTING.md`
- `CONTRIBUTING_CN.md`
- `COPYRIGHT`
- `.github/ISSUE_TEMPLATE/*`
- `docs-site/package.json`
- `docs-site/README.md`
- `docs-site/docs.json`
- `docs-site/index.mdx`
- `docs-site/zh/index.mdx`
- `docs-site/start/**`
- `docs-site/zh/start/**`
- `marketplace/README.md`
- `marketplace/index.json`

## Validation Commands

```bash
rtk rg -n "Trellis|trellis|TRELLIS|Mindfold|mindfold-ai|trytrellis|docs\\.trytrellis" README.md README_CN.md CONTRIBUTING.md CONTRIBUTING_CN.md .github docs-site marketplace
rtk git status --short
```

Build/test are not required unless executable docs tooling is changed.
