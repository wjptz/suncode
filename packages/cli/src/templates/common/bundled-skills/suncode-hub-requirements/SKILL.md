---
name: suncode-hub-requirements
description: "Use when pulling Suncode Hub requirements, starting a Hub-backed team task, syncing a Hub requirement into a local Suncode task, or binding a local task to a Hub requirement."
---

# Suncode Hub Requirements

Use this skill only for projects that have Suncode Hub enabled. If Hub is disabled, say that the project is using the normal local Suncode workflow and stop this Hub-specific flow.

## Rules

- Never print or persist `SUNCODE_HUB_TOKEN`.
- Do not ask the user to leave the agent and run a separate Hub command unless a command fails and manual recovery is needed.
- Do not create or bind a task without a concrete Hub requirement ID.
- Do not upload documents from unrelated task directories.
- Treat Hub API as control plane only. Long requirement documents come through Hub-signed MinIO download URLs handled by `suncode hub` commands.

## Flow

1. Run `suncode hub status`.
   - If disabled, continue with the ordinary Suncode workflow.
   - If enabled but auth/config is missing, explain the exact missing value. For auth, the user must provide `SUNCODE_HUB_TOKEN`.
2. Run `suncode hub pull` to fetch requirements for the current `.suncode/.developer` identity.
3. Select the requirement with the user when multiple candidates are available.
4. If the requirement body or acceptance criteria is a document payload, download it through the signed MinIO URL before summarizing it. Do not expect the Hub API response to contain the long document body.

```bash
suncode hub download-document \
  --document-id "<documentId>" \
  --filename "<filename>" \
  --sha256 "<sha256>" \
  --target-dir ".suncode/hub-inbox/<requirementId>"
```
5. Create the local task with Hub metadata:

```bash
python3 ./.suncode/scripts/task.py create "<title>" \
  --slug "<slug>" \
  --hub-project-id "<projectId>" \
  --hub-developer-id "<developerId>" \
  --hub-requirement-id "<requirementId>" \
  --hub-requirement-revision "<revision>" \
  --hub-task-role single
```

For a parent task, use `--hub-task-role parent`. For a child task, use `--parent <parent-task>` and let Suncode inherit the parent requirement metadata when possible.

6. Check whether the `after_create` hook bound the task. If needed, run:

```bash
suncode hub create-task --task-json "$TASK_JSON_PATH"
```

7. Write or update only the new task's `prd.md`, `design.md`, `implement.md`, and optional `research/**` files.
8. After planning is complete, run:

```bash
suncode hub submit-plan --task <task-dir>
```

If Hub review later requests changes, pull the review with `suncode hub pull-review --task <task-dir>`. If a review comment or requirement change contains a document payload, download it into the current task before editing:

```bash
suncode hub download-document --document-id "<documentId>" --task "<task-dir>"
```

Update only the current task's planning docs, then submit the plan again.
