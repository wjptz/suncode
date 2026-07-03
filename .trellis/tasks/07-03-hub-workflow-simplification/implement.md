# Hub Workflow Simplification Implementation Plan

## Pre-Implementation

- [x] Run GitNexus impact analysis before editing any function/class/method touched by this task.
- [x] Re-read relevant specs:
  - `.trellis/spec/cli/backend/suncode-hub-collaboration.md`
  - `.trellis/spec/cli/backend/platform-integration.md`
  - `.trellis/spec/cli/backend/workflow-state-contract.md`
  - `.trellis/spec/cli/unit-test/conventions.md`
- [x] Confirm current test baseline for Hub command tests if feasible.

## P1: Workflow Gate And AI Burden Reduction

- [x] Add or wire a Hub pre-start gate.
  - [x] Preferred: add `before_start` lifecycle hook and run it before `task.py start` mutates local state.
  - [x] Built-in Hub `before_start` calls `suncode hub preflight-start --task-json "$TASK_JSON_PATH"` for Hub-bound tasks.
  - [x] Ensure Hub off / local-only / unbound tasks return skipped/disabled without blocking ordinary start.
  - [x] Fallback was not needed because the hook path is implemented and covered.
  - [x] Add tests for `confirm` / `block` / `bypass`.
  - [x] Add tests for local-only and Hub-off no-interference behavior.

- [x] Add `suncode hub plan-ready --task current`.
  - [x] Validate Hub-bound task through existing Hub task submission checks.
  - [x] Submit plan artifacts.
  - [x] Generate or read structured subtasks.
  - [x] Submit subtasks.
  - [x] Run preflight start only after prior plan/subtask steps are continue-safe.
  - [x] Return structured result and human summary.

- [x] Implement auto subtasks.
  - [x] Add conservative `implement.md` checklist parser.
  - [x] Keep `subtasks.json` as override.
  - [x] Return explicit missing/parse status instead of silent skip.
  - [x] Add tests for generated subtasks, override subtasks, and empty/invalid inputs.

- [x] Reduce `<hub-state>` noise.
  - [x] Hub off: silent or one-line guardrail.
  - [x] Hub on local-only: minimal do-not guardrail.
  - [x] Hub-bound: compact machine-readable state.
  - [x] Service failure: fail closed.
  - [x] Update Python hook and OpenCode plugin tests.

- [x] Add `suncode hub finish --task current`.
  - [x] Validate Hub-bound task through existing spec/completion submission checks.
  - [x] Enforce required review gate by reusing existing completion review manifest checks.
  - [x] Check completion artifact presence.
  - [x] Call `submit-spec`.
  - [x] Call `submit-completion`.
  - [x] Preserve failing step in output by short-circuiting before later workflow actions.

## P2: State Machine, Reliability, Naming, Docs

- [x] Centralize Hub workflow state output in the Hub state command.
  - [x] Define status codes and allowed/blocked action model.
  - [x] Feed `hub state --json`.
  - [x] Add `hub state --prompt --hook`.
  - [x] Add golden tests.

- [x] Refactor hook Hub prompt generation.
  - [x] Keep Python hook and OpenCode JS plugin entrypoints.
  - [x] Move Hub prompt logic to CLI.
  - [x] Hooks call `suncode hub state --prompt --hook` with short timeout.
  - [x] Hooks inject fail-closed block if CLI call fails.

- [x] Add sync failure queue.
  - [x] Define `.suncode/.runtime/hub-sync-queue.jsonl` schema.
  - [x] Record best-effort hook failures.
  - [x] Show `pendingSyncCount` in `hub state`.
  - [x] Add `suncode hub sync-pending`.
  - [x] Add tests for write, state display, retry success/failure retention.

- [x] Add or refine `suncode hub intake`.
  - [x] `--list` / default list behavior.
  - [x] `--requirement <id>` explicit selection.
  - [x] `--auto` only when exactly one candidate exists.
  - [x] Multiple candidates return `ambiguous` and do not create task.
  - [x] Document AI behavior for ambiguous results.

- [x] Enforce `HUB-REQ-` task naming for auto-created Hub tasks.
  - [x] `task.json.title` and `task.json.name` start with `HUB-REQ-<requirementId>`.
  - [x] Directory slug starts with `hub-req-<requirementId>`.
  - [x] Chinese title remains in display title and PRD.
  - [x] `--slug` remains ASCII and keeps Hub requirement prefix.
  - [x] Add tests for Chinese title and ambiguous multi-requirement no-create behavior.

- [x] Standardize `projectId` / `project_key` wording.
  - [x] Keep config compatibility.
  - [x] Use `projectKey` terminology in new docs where appropriate.
  - [x] Clarify `/api/agent-hub` endpoint semantics.

- [x] Update docs and bundled skills.
  - [x] Team Hub docs default to 5 commands: `state`, `intake`, `plan-ready`, `review`, `finish`.
  - [x] Low-level commands move to advanced/debug.
  - [x] `suncode-hub-finish` becomes a thin wrapper over `hub finish`.
  - [x] `suncode-hub-requirements` uses `hub intake`.
  - [x] `suncode-hub-spec-sync` remains explicit for pull/refresh scenarios.

## Validation

- [x] Run targeted Hub command tests.
- [x] Run hook/plugin integration tests touched by Hub prompt changes.
- [x] Run unit tests for auto subtasks parser and sync queue.
- [x] Run typecheck.
- [x] Run build.
- [x] Run full relevant verification gate before marking complete.

## Rollback Points

- Keep low-level Hub commands intact so high-level command failures can fall back to existing flows.
- Gate hook prompt centralization behind tests before removing duplicated fallback logic.
- Keep `subtasks.json` override behavior so auto parser bugs do not block teams.
- Keep `hub.projectId` compatibility while adding `projectKey` wording.
