# Suncode Public Branding

## Goal

Rebrand current public-facing repository surfaces from Trellis/Mindfold to
Suncode/wjptz without changing runtime behavior yet.

## Parent Context

- Parent task: `06-29-suncode-full-migration`.
- Phase 0 inventory: `../06-29-suncode-full-migration/research/phase-0-inventory.md`.
- Product boundary decision: Suncode and Trellis are independent. Suncode must
  not convert or mutate existing Trellis installations or `.trellis` project
  content.

## Requirements

- Update current public branding in the main repository:
  - `README.md`
  - `README_CN.md`
  - `CONTRIBUTING.md`
  - `CONTRIBUTING_CN.md`
  - GitHub issue templates and community links under `.github/`
  - package descriptions and repository URLs only where they are user-visible
    branding and not package identity behavior owned by the CLI package task.
- Update docs-site public branding surfaces:
  - `docs-site/package.json`
  - `docs-site/README.md`
  - `docs-site/docs.json`
  - current EN/ZH docs pages and navigation entries that describe the active
    product.
- Update marketplace public branding surfaces:
  - `marketplace/README.md`
  - current marketplace index names/descriptions only if they are not blocked by
    deeper package/runtime changes.
- Preserve license and attribution:
  - Do not remove AGPL-3.0 license text.
  - Do not delete original upstream copyright attribution.
  - Add Suncode/wjptz attribution where appropriate.
- After explicit user confirmation, create the target public GitHub
  repositories and point local repository remotes/submodule URLs at them:
  - `wjptz/suncode`
  - `wjptz/suncode-docs`
  - `wjptz/suncode-marketplace`
- Do not change runtime behavior:
  - Do not rename npm packages in this task.
  - Do not change CLI binaries.
  - Do not change `.trellis`/`.suncode` runtime paths.
  - Do not update template generation logic.
  - Do not publish or push.

## Acceptance Criteria

- [x] Main README surfaces describe Suncode and no longer send current users to
      Mindfold/Trellis as the primary product.
- [x] Docs-site visible metadata and current navigation use Suncode naming where
      appropriate.
- [x] Marketplace README/current labels use Suncode naming where appropriate.
- [x] Historical changelogs, upstream history, and legal attribution are not
      blindly rewritten.
- [x] A static audit classifies remaining Trellis/Mindfold references in touched
      branding surfaces as one of: historical, license-attribution, pending
      later phase, or bug.
- [x] No product runtime behavior changes are included in this task.
- [x] Target public GitHub repositories exist and local remotes/submodule URLs
      point at them, without pushing repository contents yet.

## Out of Scope

- npm package rename to `@wjptz/suncode`.
- CLI binary rename to `suncode`.
- Agent command/skill rename.
- `.suncode` persistence isolation.
- Forking/pushing `wjptz/suncode-docs` or `wjptz/suncode-marketplace`.
- Pushing main repository or submodule contents to GitHub.
- Rewriting historical changelog pages solely for cosmetic reasons.

## Validation

- Static audit:
  - `rtk rg -n "Trellis|trellis|TRELLIS|Mindfold|mindfold-ai|trytrellis|docs\\.trytrellis" README.md README_CN.md CONTRIBUTING.md CONTRIBUTING_CN.md .github docs-site marketplace`
- Git scope check:
  - `rtk git status --short`
- No build/test required unless implementation touches executable docs tooling.
