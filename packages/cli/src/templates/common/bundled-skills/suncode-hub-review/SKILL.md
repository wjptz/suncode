---
name: suncode-hub-review
description: "Run the post-implementation Suncode Hub code review workflow when Hub code review is enabled or required. Use after implementation, after code review feedback has been fixed, or before finishing work in projects that require code review."
---

# Suncode Hub Review

Use this skill when the current task is bound to Suncode Hub, implementation has started, and code review is enabled or required. Run it after final validation/spec updates and before creating the work commit.

Do not use this skill to check plan approval, plan comments, or start-review status after `suncode hub plan-ready`. For plan-stage Hub comments/status, run:

```bash
suncode hub pull-review --task current
```

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
4. If status is `approved`, commit the reviewed work, then continue the normal finish flow.
5. If status is `blocked`, report the blocker and do not treat the task as approved.

## Boundaries

- Review is report-only. Do not ask the review provider to edit files.
- Do not manually add a Review Boundary section or a changed-file list. The
  review prompt should stay lightweight: describe the task entry point, list
  task/requirement file paths, and constrain provider behavior. The provider
  decides what to inspect by reading task files, directory-level code area
  hints, related module code, and any explicit `--module` scopes the user
  supplied.
- The provider prompt should review the implementation against the task
  requirement/design/implementation plan; it must not turn into a plan review.
- The provider prompt should emphasize requirement-level review: functional
  completeness, logic correctness, boundary cases, data/API contracts,
  user-visible behavior, security/side effects, and maintainability.
- Do not ask the provider to run build, tests, lint, format, dependency
  install, code generation, or other validation commands. Existing validation
  artifacts may be read as background only.
- The provider prompt may include directory-level code area hints derived from
  git changes, but must not include a concrete changed-file list.
- Provider descriptive fields (`summary`, issue `title`, issue `detail`) should
  be Chinese. The provider returns a single fenced JSON block; the CLI parses it
  and renders `result.md`.
- Review belongs before the work commit. Stage intended new files first when needed so the reviewed diff matches the content that will be committed.
- Do not submit completion when `hub.review.required=true` until the latest review is approved for the current diff.
- Do not upload files or patch Hub status by hand; `suncode hub review` owns those side effects.
- Treat `result.md` as the reviewer-authored finding summary. Do not treat `raw-output.md` as the review result; it is only a provider transcript and may be disabled by config.
- If review is skipped because Hub review is disabled or the provider is unavailable with bypass policy, keep the existing workflow unchanged.
