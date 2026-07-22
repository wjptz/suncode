# Trellis Upstream Synchronization Ledger

This append-only ledger explains every cursor recorded in `sync-state.json`. Add new entries at the top, preserve old entries verbatim, and give each entry one unique `<!-- sync-entry:<id> -->` marker.

## Current Resume Point

The next upstream review starts exclusively after official Trellis `v0.6.8` commit `dc68f5a92a68489b681c511f4a784e413d724e85`.

Do not restart from the fork baseline. Do not use Suncode's same-name local `v0.6.6`, `v0.6.7`, or `v0.6.8` tags as official refs.

<!-- sync-entry:2026-07-22-v0.6.8 -->
## 2026-07-22: Official v0.6.8

### Range And Evidence

| Role | Version | Full commit |
| --- | --- | --- |
| Previous reviewed release | `v0.6.7` | `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a` |
| Reviewed release | `v0.6.8` | `dc68f5a92a68489b681c511f4a784e413d724e85` |

Official repository: `https://github.com/mindfold-ai/Trellis.git`.

The official lightweight tag was fetched without overwriting local tags into
`refs/remotes/upstream/releases/v0.6.8`. The previous checkpoint is an ancestor
of the target, and the exact exclusive/inclusive range
`e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a..dc68f5a92a68489b681c511f4a784e413d724e85`
contains 41 reachable commits.

Every one of those 41 commits, including merges and release bookkeeping, is
enumerated in the task research matrix. The 23 behavior classes resolved to 18
semantic adoptions, two already-equivalent Suncode behaviors, two intentional
rejections, and one identity/bookkeeping exclusion class.

### Adoption Outcome

| IDs | Adopted behavior | Suncode-specific result |
| --- | --- | --- |
| A1 | ZCode zero-dependency read-only SQLite/WAL memory | Added bounded SQLite parsing, stable snapshot and corruption handling, ZCode session/project/search/context/extract integration, and tests without native dependencies. |
| A3-A5 | Grok Build, Kimi Code, and `suncode platforms --json` | Added ownership-aware registry/configurator/template/CLI support, neutral shared skills, stable JSON output, and human output for 21 configured platforms. |
| A6-A7 | Task JSON interfaces and default-branch semantics | Added `task.py list/current --json`, derived parent display status, `--base-branch`, default-branch resolution, fallback warnings, and non-blocking stale-branch diagnostics in both live and generated scripts. |
| A8-A11, A13 | Update, migration, registry, and YAML safety | Protected reintroduced templates, made `rename-dir` canonical-target aware, migrated Pi skills safely to `.agents/skills`, removed registry `preferOffline`, and safely quoted generated command descriptions. |
| A12 | Oh My Pi Bash context bridge | Injects the current `SUNCODE_CONTEXT_ID` only into Bash tool calls while preserving explicit per-call env overrides, command text, non-Bash input, and process env. |
| A14-A17 | Planning approval, adaptive SessionStart, Codex native dispatch, and channel sandbox | Requires approval in a subsequent message after the latest final plan, preserves Suncode's inline default, adds strict/fail-open native `SubagentStart` context with `max_depth=1`, and types the three Codex sandbox modes end-to-end. |
| A19 | Build-before-test CI order | Main CI and publish workflows now build the Suncode CLI before tests that consume `dist`, without changing publishing identity. |
| A21 | Specs, README, docs-site, and marketplace workflow | Updated Suncode contracts and bilingual docs, and committed the native workflow mirror in its own repository. |

### Equivalent, Rejected, And Excluded

- A18 fleet hardening and A22 Pi's shorter display name were already present and
  remain protected by regression tests.
- A2 ZCode hooks/native settings were rejected to preserve Suncode's proven
  pull-based, no-settings ZCode boundary; the readonly memory adapter does not
  depend on them.
- A20 full-test pre-commit/submodule initialization was rejected because this
  repository deliberately keeps pre-commit at lint-staged speed and runs full
  tests in CI and the task quality gate. `.husky/pre-commit` was not changed.
- A23 upstream versions, manifests, QR assets, tasks, journals, merge commits,
  release tags, and raw submodule pointers were not copied. Suncode remains at
  package version `0.6.10`, retains its own runtime identity and local history,
  and did not create, overwrite, or push any tag.

### Local Commits

- Suncode main repository implementation: `a7b2ff82e83ed024230428684b9ee1dd48b45cfc`
  (`feat: align suncode with trellis v0.6.8`).
- Marketplace native workflow mirror: `62f7bf94df10557936b01708f431013c66538d22`
  (`docs: sync native workflow with Trellis v0.6.8`).
- Docs site: `129339dad5b0ed03546258985771d6ade1c54888`
  (`docs: align platform guides with trellis v0.6.8`).

### Verification

- Core: 20 test files passed, `332/332` tests passed, one environment-dependent
  parser case skipped.
- CLI: 63 test files passed, `1512/1512` tests passed.
- Root lint, typecheck, build, and changed-file whitespace checks passed.
- Basedpyright reported zero errors; 64 existing re-export warnings remained.
- Docs-site ESLint, Markdownlint, shared-group validation, and incremental
  Prettier checks passed for all 18 changed pages.
- Bundled and marketplace native workflow templates are byte-identical.
- GitNexus compare review reported CRITICAL breadth (`163` changed symbols,
  `89` affected symbols/process paths, `101` files) because update, task, mem,
  channel, and platform hubs changed together. The high-fan-out paths were
  reviewed before editing and are covered by targeted failure/mixed-ownership
  tests plus the full suites above. User-owned dirty files were excluded from
  every commit.

### Detailed Sources

- Task: `.trellis/tasks/07-22-sync-trellis-v0-6-8/`
- Complete 41-commit classification:
  `.trellis/tasks/07-22-sync-trellis-v0-6-8/research/upstream-v0.6.8-adoption.md`
- Requirements and design:
  `.trellis/tasks/07-22-sync-trellis-v0-6-8/prd.md` and
  `.trellis/tasks/07-22-sync-trellis-v0-6-8/design.md`
- Implementation and verification:
  `.trellis/tasks/07-22-sync-trellis-v0-6-8/implement.md`

### Next Review

Start after `dc68f5a92a68489b681c511f4a784e413d724e85`. Query official tags again,
fetch newer releases into `refs/remotes/upstream/releases/`, and review only the
new exclusive range.

<!-- sync-entry:2026-07-20-v0.6.6-v0.6.7 -->
## 2026-07-20: Official v0.6.6 And v0.6.7

### Range And Evidence

| Role | Version | Full commit |
| --- | --- | --- |
| Common fork baseline | `v0.6.5` | `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba` |
| First reviewed release | `v0.6.6` | `41b6a460d298861991b082c7a7fbfa1f9f42fc6f` |
| Last reviewed release | `v0.6.7` | `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a` |

Official repository: `https://github.com/mindfold-ai/Trellis.git`.

The official release refs were fetched without overwriting local tags:

- `refs/remotes/upstream/releases/v0.6.5`
- `refs/remotes/upstream/releases/v0.6.6`
- `refs/remotes/upstream/releases/v0.6.7`

Suncode's local same-name tags point to different commits, so this review used official commits and behavior-level evidence rather than tag merge or range cherry-pick.

### Adoption Outcome

All 14 substantive candidates were adopted semantically under Suncode identity and ownership contracts:

| ID | Adopted behavior | Suncode-specific result |
| --- | --- | --- |
| A1 | Channel and worker safe storage names plus defensive discovery | CLI/core path handling rejects traversal and skips legacy invalid directories. |
| A2 | Atomic TypeScript and Python state writes | Interrupted writes preserve the prior state and clean temporary files. |
| A3 | Structured `AGENTS.md` uninstall scrub plus dirty-data guard | Uninstall removes only Suncode-owned blocks and fails closed for uncommitted Suncode data. |
| A4 | Task archive root boundary | Only direct task directories under the Suncode task root can be archived. |
| A5 | Temporary-first template overwrite | Failed downloads retain the installed template and cleanup errors do not mask the primary result. |
| A6 | Manifest-owned directory migration and journal collision protection | User-owned paths are not moved and existing journals are never overwritten. |
| A7 | Ordered Channel stdout processing with backpressure | Parser and event application order now follows input order with maximum processing concurrency one. |
| A8 | Windows npm Node-script shim support | Node scripts use `process.execPath`, argument arrays, local-bin priority, and `shell: false`. |
| A9 | Pi hidden persistent runtime context and stable system prompt | User input remains unchanged and runtime context survives turns and compaction without prompt churn. |
| A10 | ZCode agent path correction | Suncode writes `.zcode/agents/` while handling legacy Suncode-owned assets safely. |
| A11 | Codex inline JSONL suppression and task-create hygiene | Inline mode avoids unused manifests; task creation handles date prefixes, `--no-start`, descriptions, and activation feedback. |
| A12 | Journal stale-branch fallback | Deleted task branches no longer leak into new journal entries. |
| A13 | Project-local Pi `sessionDir` support | Relative paths resolve from the project and deduplicate with global roots. |
| A14 | Complete Oh My Pi platform support | Registry, CLI, init/update/uninstall, commands, skills, agents, extension, workflow, task store, and adapter support use Suncode names and ownership-aware `.omp` detection. |

### Local Commits

- Suncode main repository implementation: `842056c1bc9eae17cae85f3d81df0dceed01ee21` (`feat(cli): adopt Trellis 0.6.6 and 0.6.7 updates`).
- Marketplace native workflow mirror: `3619bfedf1a96569db3fe95cc805af0424092007` (`docs: add Oh My Pi to native workflow`).
- Task archive bookkeeping: `edfbe24777840f2040d0f82240dd6ce68a2a3b78`.
- Developer journal bookkeeping: `36796e378dec728b93de14b4c6293fbce788d5bb`.

### Verification

- Core tests: `302/302` passed.
- CLI tests: `1468/1468` passed.
- Combined tests: `1770/1770` passed.
- Lint, typecheck, build, and `git diff --check` passed.
- Basedpyright reported zero errors; 64 pre-existing re-export warnings remained.
- GitNexus change detection reported broad shared-runtime impact, covered by the full test matrix and ownership/failure-path regressions.

### Intentional Non-Extension

No OMP offline memory adapter was claimed. Official `v0.6.6` provided runtime session identity through the OMP extension but did not define a stable on-disk session root or JSONL schema. The existing Pi memory adapter depends on Pi-specific disk settings and records, so treating OMP as Pi would fabricate compatibility. Revisit this only when OMP publishes a stable persistence contract.

### Detailed Sources

- Archived task: `.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/`
- Adoption research: `.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/research/upstream-v0.6.6-v0.6.7-adoption.md`
- Design: `.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/design.md`
- Implementation and verification: `.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/implement.md`
- Journal summary: `.trellis/workspace/kangmeng/journal-1.md`, Session 18.

### Next Review

Start after `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`. Query official tags again, fetch newer releases into `refs/remotes/upstream/releases/`, and review only the new commit range.
