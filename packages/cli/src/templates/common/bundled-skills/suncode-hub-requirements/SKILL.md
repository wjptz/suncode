---
name: suncode-hub-requirements
description: "Use when pulling Suncode Hub requirements, starting a Hub-backed team task, syncing a Hub requirement into a local Suncode task, or binding a local task to a Hub requirement."
---

# Suncode Hub Requirements

Use this skill only for projects that have Suncode Hub enabled. If Hub is disabled, say that the project is using the normal local Suncode workflow and stop this Hub-specific flow.

## Rules

- Never print or persist Hub tokens, passwords, or auth headers.
- If `<hub-state>` says `hub-task:local-only`, do not run Hub task submission or lifecycle commands unless the user explicitly asks to bind a Hub requirement.
- Do not ask the user to leave the agent and run a separate Hub command unless a command fails and manual recovery is needed.
- Do not create or bind a task without a concrete Hub requirement ID.
- Do not upload documents from unrelated task directories.
- Treat Hub API as control plane only. Long requirement documents come through Hub-signed MinIO download URLs handled by `suncode hub` commands.

## Flow

1. Run `suncode hub state`.
   - If disabled, continue with the ordinary Suncode workflow.
   - If enabled but auth/config is missing, explain the exact missing value. For auth, ask the user to run `suncode hub login`.
2. Run `suncode hub intake --auto` only when the user wants the single available assigned requirement. If multiple candidates are available, the command returns `ambiguous`; ask the user which requirement ID to claim, then run `suncode hub intake --requirement <id>`.
3. The local task created by `hub intake` must keep the generated `HUB-REQ-<requirementId>` prefix in `task.json.name` and `task.json.title`. Chinese requirement titles remain in the human-facing title after that prefix; do not translate or pinyin them for display. The directory slug stays ASCII and starts with `hub-req-<requirementId>`.
4. `hub intake` records the task route in `task.json.meta.hub.taskType`:
   - taskType: `standard` — use the normal planning flow.
   - taskType: `quick` — use the fast route: keep `prd.md` minimal, run `suncode hub plan-ready --task current` to upload the plan artifacts, skip Hub start preflight, skip plan approval, skip Hub code review/check-agent review, then start implementation directly. Quick tasks still need minimal deterministic validation where feasible and still upload completion artifacts with `suncode hub finish --task current`.
   - taskType: `change` — treat the current requirement as authoritative, and use `sourceTask` only to understand the previous requirement. Read `research/source-task.md` when it exists before editing requirements or code.
5. `hub intake` 已自动同步 Hub spec；若 intake 输出包含 `spec sync FAILED`，可运行 `suncode hub pull-spec` 重试，spec 同步失败不阻塞规划。Hub spec 是权威约束，不要手工对比或合并 spec 文件。
6. Write or update only the new task's `prd.md`, `design.md`, `implement.md`, and optional `research/**` files.
7. After planning is complete, run:

```bash
suncode hub plan-ready --task current
```

For standard and change tasks, `plan-ready` submits plan artifacts, derives or uploads structured subtasks, and runs Hub start preflight. For quick tasks, `plan-ready` submits plan artifacts and any available structured subtasks, then locally skips Hub start preflight and plan approval. Write `subtasks.json` only when the derived `implement.md` checklist needs an explicit override.

If Hub review later requests changes, pull the review with `suncode hub pull-review --task <task-dir>`. If a review comment or requirement change contains a document payload, download it into the current task before editing:

```bash
suncode hub download-document --document-id "<documentId>" --task "<task-dir>"
```

Update only the current task's planning docs, then submit the plan again.
