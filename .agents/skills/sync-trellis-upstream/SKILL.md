---
name: sync-trellis-upstream
description: "Track and semantically adopt official Trellis releases into the Suncode fork from a recorded checkpoint. Use when checking, comparing, synchronizing, or adopting new Trellis upstream versions; resuming a previous Trellis sync; or when the user asks ‘同步 Trellis 上游’, ‘检查 Trellis 新版本’, ‘采纳 Trellis 更新’, or ‘从上次同步点继续’."
---

# Sync Trellis Upstream

Continue official Trellis review from a validated cursor, preserve Suncode's fork contracts, and record every reviewed range so later runs never repeat settled history.

## Start From The Checkpoint

1. Use `python` on Windows and `python3` on macOS/Linux. Do not rely on the script shebang.
2. Run `scripts/sync_checkpoint.py validate` from this skill directory, or pass the repository-root-relative script path from the Suncode root.
3. Run `scripts/sync_checkpoint.py show` and treat `last_reviewed.commit` as the exclusive start of upstream discovery.
4. Read [references/fork-boundaries.md](references/fork-boundaries.md) before classifying or implementing any upstream change.
5. Read [references/sync-ledger.md](references/sync-ledger.md) when the current checkpoint, an earlier decision, or an intentional exclusion needs explanation. Follow the linked archived Trellis task only when the ledger summary is insufficient.

Stop if checkpoint validation fails. Repair the state from Git objects and ledger evidence; never bypass validation or invent a cursor.

## Follow The Project Workflow

1. Load `trellis-start` and obey `.trellis/workflow.md`.
2. Use a dedicated Trellis task for a real upstream review. Obtain task-creation consent when the workflow requires it.
3. During Phase 1, persist release evidence and the commit-level adoption matrix under the task's `research/` directory.
4. Complete `prd.md`, `design.md`, and `implement.md` for a multi-version or cross-layer adoption, then obtain explicit implementation approval before `task.py start`.
5. Load `trellis-before-dev` before implementation. Use YCE for repository code location and GitNexus upstream impact before modifying every existing function, class, or method. Report HIGH or CRITICAL impact before editing.

Do not advance the checkpoint merely because a task was created or a release was fetched.

## Discover Official Releases Safely

1. Verify `git remote get-url upstream` exactly matches the repository recorded in `references/sync-state.json`.
2. Query official tags with `git ls-remote --tags upstream`. For an annotated tag, use its peeled `^{}` commit as the release identity.
3. Select only releases after `last_reviewed` according to SemVer and the user's requested stability channel.
4. Fetch each selected tag without touching local tags:

   ```text
   git fetch --no-tags upstream refs/tags/<tag>:refs/remotes/upstream/releases/<tag>
   ```

5. Resolve `refs/remotes/upstream/releases/<tag>^{commit}` and require it to equal the official remote commit.
6. Require `last_reviewed.commit` to be an ancestor of the target. If it is not, stop and report a possible upstream history rewrite or incorrect release identity.

Never use a same-name local `refs/tags/<tag>` as official evidence. Never assume a cached `upstream/main` is current.

## Build The Adoption Matrix

Review `last_reviewed.commit..target_commit` commit by commit. Record at least:

| Field | Required content |
| --- | --- |
| Upstream commit | Full 40-character commit ID and subject |
| Behavior | User-visible or invariant-level change |
| Upstream evidence | Release, code, and tests that define the behavior |
| Suncode evidence | Current symbols, tests, and fork-specific differences |
| Decision | Adopt, adapt, already equivalent, or intentionally reject |
| Reason | Value, dependency, identity, ownership, and compatibility reasoning |
| Validation | Tests and failure paths needed if adopted |

Exclude release bookkeeping, journals, archived tasks, dogfood files, QR codes, and submodule pointer-only changes only after recording why they are non-product changes.

## Implement Semantically

- Use the upstream commit as a behavior specification and current Suncode code as the implementation baseline.
- Preserve `.suncode`, `SUNCODE_*`, `@wjptz/suncode*`, Suncode managed blocks, Suncode commands, and Suncode persistence.
- Preserve project-specific Hub, Chinese planning, workflow/spec injection, channel/mem extensions, and platform adaptations unless the reviewed requirement explicitly changes them.
- Apply small, reviewable batches. Do not merge a release tag, cherry-pick a whole release range, or run `trellis update` / `trellis upgrade` as source synchronization.
- Test failure paths, mixed ownership, and cross-platform behavior in addition to the happy path.
- Finish with affected-package tests, lint, typecheck, build, `git diff --check`, and GitNexus `detect_changes(scope="compare", base_ref="main")`.

## Record And Advance

1. Commit verified implementation changes first so the adoption has a stable local commit ID. Do not push.
2. Append one entry to `references/sync-ledger.md`. Add a unique marker in the exact form `<!-- sync-entry:<id> -->` and record the upstream range, matrix outcome, local commits, validation, exclusions, and task path.
3. For a review that adopted code, run:

   ```text
   scripts/sync_checkpoint.py advance --reviewed-version <tag> --reviewed-commit <commit> --date <YYYY-MM-DD> --ledger-entry <id> --task <task-path> --local-commit <local-commit> [--related-commit <repo-path>=<commit> ...]
   ```

4. For a completed review with no new Suncode commit, omit `--local-commit`; this advances `last_reviewed` while retaining `latest_adoption`.
5. Run `scripts/sync_checkpoint.py validate` again.
6. Commit the ledger and JSON cursor as a separate checkpoint record, then complete `trellis-finish-work`.

`advance` is intentionally fail-closed and has no force option. An identical retry is a successful no-op; conflicting metadata for an already-recorded commit is an error.

## Never Advance When

- Any upstream commit in the target range lacks a recorded classification.
- Approved implementation is unfinished, unverified, or uncommitted.
- The ledger entry or exact marker is missing.
- The official target ref is missing or disagrees with the recorded commit.
- The target is not a descendant of the current `last_reviewed` commit.
- Git status contains unresolved task changes or the proposed commit would include unrelated user work.

In these cases, leave `references/sync-state.json` unchanged and report the concrete blocker.
