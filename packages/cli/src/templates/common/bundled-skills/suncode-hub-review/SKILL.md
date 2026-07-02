---
name: suncode-hub-review
description: "Run the Suncode Hub task review workflow when Hub review is enabled or required. Use when a Hub-bound task needs review, when review feedback has been fixed, or before finishing work in projects that require Hub review."
---

# Suncode Hub Review

Use this skill when the current task is bound to Suncode Hub and review is enabled or required.

## Rule

Do not manually invent review prompts, round numbers, Hub status updates, upload steps, or finish gates. Let Suncode do the orchestration.

Run:

```bash
suncode hub review --task current
```

Add one or more module scopes only when the user explicitly gives them:

```bash
suncode hub review --task current --module packages/cli/src/commands/hub
```

## Workflow

1. Run `suncode hub review --task current`.
2. Read the command result, the newest `reviews/round-NNN/review.json`, and the concise `reviews/round-NNN/result.md` report.
3. If status is `changes_requested`, fix the must-fix items and run review again.
4. If status is `approved`, continue the normal finish flow.
5. If status is `blocked`, report the blocker and do not treat the task as approved.

## Boundaries

- Review is report-only. Do not ask the review provider to edit files.
- Do not submit completion when `hub.review.required=true` until the latest review is approved for the current diff.
- Do not upload files or patch Hub status by hand; `suncode hub review` owns those side effects.
- Treat `result.md` as the reviewer-authored finding summary. Do not treat `raw-output.md` as the review result; it is only a provider transcript and may be disabled by config.
- If review is skipped because Hub review is disabled or the provider is unavailable with bypass policy, keep the existing workflow unchanged.
