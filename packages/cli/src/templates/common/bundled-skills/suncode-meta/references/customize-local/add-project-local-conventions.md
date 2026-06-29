# Add Project-Local Conventions

Often the user does not need to change Suncode mechanics; they need local AI to understand their team's conventions. In that case, prefer `.suncode/spec/` or a project-local skill instead of editing `suncode-meta`.

## Where To Put Things

| Content type | Location |
| --- | --- |
| Rules code must follow | `.suncode/spec/<layer>/` |
| Cross-layer thinking methods | `.suncode/spec/guides/` |
| AI capability for a project-specific flow | Platform-local skill |
| One-off task material | `.suncode/tasks/<task>/` |
| Session summary | `.suncode/workspace/<developer>/journal-N.md` |

## Create A Project-Local Skill

If the user wants AI to know "how this project customizes Suncode," create a local skill:

```text
.claude/skills/suncode-local/
└── SKILL.md
```

Example:

```md
---
name: suncode-local
description: "Project-local Suncode customizations for this repository. Use when changing this project's Suncode workflow, hooks, local agents, or team-specific conventions."
---

# Suncode Local

## Local Scope

This skill documents this repository's Suncode customizations only.

## Custom Workflow Rules

- ...

## Local Hook Changes

- ...

## Local Agent Changes

- ...
```

For multi-platform projects, place equivalent versions in other platform skill directories, or use `.agents/skills/` for platforms that support the shared layer.

## Write To `.suncode/spec/`

If the content is a coding convention, write it to spec. Examples:

```text
.suncode/spec/backend/error-handling.md
.suncode/spec/frontend/components.md
.suncode/spec/guides/cross-platform-thinking-guide.md
```

After writing it, update the corresponding `index.md` so AI can find the new rule from the entry point.

## Make The Current Task Use New Conventions

After writing a spec, add it to the current task context:

```bash
python3 ./.suncode/scripts/task.py add-context <task> implement ".suncode/spec/backend/error-handling.md" "Error handling conventions"
python3 ./.suncode/scripts/task.py add-context <task> check ".suncode/spec/backend/error-handling.md" "Review error handling"
```

## Do Not Store Project-Private Rules In `suncode-meta`

`suncode-meta` is a public skill for understanding Suncode architecture and local customization entry points. Put project-private content in:

- `.suncode/spec/`
- a project-local skill
- the current task
- workspace journal

This prevents future updates to Suncode's built-in `suncode-meta` from overwriting the team's own conventions.
