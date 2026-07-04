---
name: suncode-hub-finish
description: "Use when finishing a Suncode Hub-backed task, preparing implementation summaries, submitting spec changes, evaluating reusable knowledge, or sending completion artifacts to Hub."
---

# Suncode Hub Finish

Use this skill only when the current task is Hub-backed: already bound to Suncode Hub or pending a remote binding with `meta.hub.requirementId`. If the project is not Hub-enabled, use the normal Suncode finish-work flow.

## Rules

- Work only on the current task or the task explicitly named by the user.
- Do not upload sibling task PRD, design, implement, summary, or retrospective documents.
- Do not submit empty summaries or unverified claims.
- Do not print or persist Hub tokens, passwords, or auth headers.
- If `<hub-state>` says `hub-task:local-only`, stop this Hub-specific flow unless the user explicitly asks to bind a Hub requirement.
- Long documents are uploaded through Hub-signed MinIO URLs by `suncode hub`; Hub API payloads must contain object references and hashes, not document bodies.
- `hub finish` does not start code review. Hub code review belongs after final validation and before the work commit; finish only verifies any required approved review still matches.
- For `meta.hub.taskType == "quick"`, do not run Hub code review or check-agent review. Quick still must produce useful completion artifacts and run `suncode hub finish --task current` so Hub receives the final upload.

## Required Local Artifacts

Before completion, ensure the current task directory has useful content in these files when applicable:

- `implementation-summary.md`
- `validation-summary.md`
- `retrospective.md`
- `reuse-assessment.md`

Keep the summaries evidence-based:

- Implementation summary: what changed and where.
- Validation summary: exact checks run and any checks not run.
- Retrospective: what was learned while doing this task.
- Reuse assessment: what can be reused as spec, template, helper, or process guidance.

## Flow

1. Confirm the active task:

```bash
python3 ./.suncode/scripts/task.py current --source
```

2. Submit Hub finish:

```bash
suncode hub finish --task current
```

`hub finish` verifies required completion artifacts, ensures the remote Hub binding (auto-binding a pending task when needed), enforces the required review gate through the existing completion submission checks for standard/change tasks, submits project-level spec artifacts, and submits completion artifacts plus commit metadata. Quick tasks bypass the review gate but not artifact upload.

3. Act on the result:
   - Missing completion artifacts: create those files with evidence-based content and rerun the command.
   - Binding failure: report the exact error to the user; do not treat the task as completed on Hub.
   - `skipped` with a local-only message: the task is not Hub-bound; continue with the normal Suncode finish workflow.
   - Success (or intentionally deferred): continue with the normal Suncode archive/finish workflow.

On demand only, when the user mentions requirement changes or Hub review comments:

```bash
suncode hub sync --task <task-dir>
suncode hub pull-review --task <task-dir>
```

If a response contains a document payload, download that exact document into the current task with `suncode hub download-document --document-id "<documentId>" --task "<task-dir>"`.
