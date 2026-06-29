# Local Customization Overview

This directory is for local AI working in a user project where Suncode was installed through npm and `suncode init` has already been run. The AI should modify generated `.suncode/` and platform directories inside the project, not Suncode CLI upstream source code.

## First Determine What The User Actually Wants To Change

| User wording | Read first |
| --- | --- |
| "Change the Suncode flow / phases / next prompt" | `change-workflow.md` |
| "Change task creation, status, archive, or hooks" | `change-task-lifecycle.md` |
| "AI did not read context / change injected content" | `change-context-loading.md` |
| "A platform hook is not behaving as expected" | `change-hooks.md` |
| "Change implement/check/research agent behavior" | `change-agents.md` |
| "Add a skill/command/workflow/prompt" | `change-skills-or-commands.md` |
| "Adjust the project spec structure" | `change-spec-structure.md` |
| "Add team conventions and local notes" | `add-project-local-conventions.md` |

## General Operation Order

1. **Confirm platform and directories**: inspect which directories exist, such as `.claude/`, `.codex/`, `.cursor/`, `.zcode/`.
2. **Confirm the current active task**: run `python3 ./.suncode/scripts/task.py current --source`.
3. **Read the local source of truth**: prefer `.suncode/workflow.md`, `.suncode/config.yaml`, and relevant platform files.
4. **Modify narrowly**: edit only files related to the user's request.
5. **Synchronize semantics**: if a shared flow changes, check whether platform entry points also need changes; if a platform entry changes, check whether `.suncode/workflow.md` still agrees.

## Local File Priority

| Layer | Files |
| --- | --- |
| Workflow | `.suncode/workflow.md` |
| Project configuration | `.suncode/config.yaml` |
| Task material | `.suncode/tasks/<task>/` |
| Project specs | `.suncode/spec/` |
| Runtime scripts | `.suncode/scripts/` |
| Platform integration | `.claude/`, `.codex/`, `.cursor/`, `.opencode/`, `.zcode/`, and similar directories |
| Shared skill | `.agents/skills/` |

## Things Not To Do By Default

- Do not edit the global npm install directory.
- Do not edit `node_modules/@wjptz/suncode`.
- Do not assume the user has the Suncode GitHub repository.
- Do not overwrite local files already modified by the user with default templates.
- Do not put team project rules into public `suncode-meta`; project rules belong in `.suncode/spec/` or a local skill.

## When To Inspect Upstream Source

Switch to an upstream source-code perspective only when the user explicitly expresses one of these goals:

- "I want to open a PR to Suncode"
- "I want to change npm package publish contents"
- "I want to fork Suncode"
- "I want to modify the generation logic for `suncode init/update`"

Otherwise, default to modifying local Suncode files inside the user project.
