# Trellis Upstream Synchronization Ledger

This append-only ledger explains every cursor recorded in `sync-state.json`. Add new entries at the top, preserve old entries verbatim, and give each entry one unique `<!-- sync-entry:<id> -->` marker.

## Current Resume Point

The next upstream review starts exclusively after official Trellis `v0.6.7` commit `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`.

Do not restart from the fork baseline. Do not use Suncode's same-name local `v0.6.6` or `v0.6.7` tags as official refs.

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
