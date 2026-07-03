---
name: suncode-hub-finish
description: "Use when finishing a Suncode Hub-backed task, preparing implementation summaries, submitting spec changes, evaluating reusable knowledge, or sending completion artifacts to Hub."
---

# Suncode Hub Finish

Use this skill only when the current task is bound to Suncode Hub. If the project is not Hub-enabled, use the normal Suncode finish-work flow.

## Rules

- Work only on the current task or the task explicitly named by the user.
- Do not upload sibling task PRD, design, implement, summary, or retrospective documents.
- Do not submit empty summaries or unverified claims.
- Do not print or persist Hub tokens, passwords, or auth headers.
- If `<hub-state>` says `hub-task:local-only`, stop this Hub-specific flow unless the user explicitly asks to bind a Hub requirement.
- Long documents are uploaded through Hub-signed MinIO URLs by `suncode hub`; Hub API payloads must contain object references and hashes, not document bodies.
- `hub finish` does not start code review. Hub code review belongs after final validation and before the work commit; finish only verifies any required approved review still matches.

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

2. If the task is not bound, run or repair:

```bash
suncode hub create-task --task <task-dir>
```

3. Pull last-minute Hub changes or review comments when the user mentions requirement changes:

```bash
suncode hub sync --task <task-dir>
suncode hub pull-review --task <task-dir>
```

If the response contains a document payload, download that exact document into the current task:

```bash
suncode hub download-document --document-id "<documentId>" --task "<task-dir>"
```

4. Submit Hub finish:

```bash
suncode hub finish --task current
```

`hub finish` checks required completion artifacts, enforces required review gate through the existing completion submission checks, submits project-level spec artifacts, and submits completion artifacts plus commit metadata. If it reports missing files, create those files with evidence-based content and rerun the command.

5. Only after Hub completion submission succeeds or is intentionally deferred, continue with the normal Suncode archive/finish workflow.
