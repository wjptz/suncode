# Suncode persistence isolation

## Goal

Make new Suncode installs fully independent from Trellis by generating and reading Suncode-owned persistence paths, environment variables, protocol markers, runtime directories, and generated documentation.

Users who install `@wjptz/suncode` should be able to initialize and use Suncode without seeing Trellis-branded runtime names in normal generated files, commands, hooks, sub-agent context, channel storage, or marketplace-installed Suncode skills.

## Confirmed Facts

- The CLI path source of truth still sets `DIR_NAMES.WORKFLOW` to `.trellis`, which drives generated workflow, workspace, task, spec, script, and agent paths. Evidence: `packages/cli/src/constants/paths.ts:9`.
- `createWorkflowStructure` creates the workflow tree from that constant and writes workflow files, scripts, config, channel runtime agents, workspace, tasks, and specs under the workflow root. Evidence: `packages/cli/src/configurators/workflow.ts:86`.
- Shared hook templates still hard-code `.trellis`, `TRELLIS_*`, and `<trellis-workflow>` protocol text in generated context. Evidence: `packages/cli/src/templates/shared-hooks/session-start.py:757`, `packages/cli/src/templates/shared-hooks/session-start.py:789`.
- Cursor shell bridging still uses `.trellis/.runtime` and `TRELLIS_HOOKS` / `TRELLIS_DISABLE_HOOKS`. Evidence: `packages/cli/src/templates/shared-hooks/inject-shell-session-context.py:21`, `packages/cli/src/templates/shared-hooks/inject-shell-session-context.py:145`.
- Channel storage still defaults to `~/.trellis/channels` and reads `TRELLIS_CHANNEL_ROOT` / `TRELLIS_CHANNEL_PROJECT`. Evidence: `packages/core/src/channel/internal/store/paths.ts:11`.
- Several generated Suncode skill and platform templates already use Suncode names for commands and agents, but still instruct users and agents to read `.trellis/*` paths and Trellis protocol markers.
- User decision: do not keep Trellis compatibility aliases, and do not migrate an already installed Trellis project into Suncode. Suncode and Trellis should be two independent tools if both are installed.

## Requirements

1. Fresh `suncode init` creates `.suncode/`, not `.trellis/`, for workflow, workspace, tasks, specs, scripts, runtime state, template hashes, config, and channel agent definitions.
2. Suncode-generated hooks, commands, prompts, sub-agent definitions, bundled skills, and local docs refer to `.suncode/*` paths and Suncode terminology for normal runtime usage.
3. Suncode runtime environment variables use `SUNCODE_*` names, including hook disable flags, context identity, Python command overrides, home-dir guard overrides, Pi CLI overrides, and channel configuration.
4. Suncode-generated protocol markers use Suncode names, including injected hook markers and workflow XML-like wrapper tags.
5. `suncode update`, `suncode uninstall`, template hash tracking, registry spec install, workflow resolution, and channel commands operate against `.suncode` only.
6. Running Suncode in a project that only has `.trellis/` must not silently migrate, import, rename, or delete Trellis data. It should behave as uninitialized Suncode unless `.suncode/` exists.
7. Existing historical migration manifests, changelogs, archive notes, and fork attribution may retain Trellis references where they describe historical Trellis releases rather than current Suncode runtime behavior.
8. Tests must be updated so the expected generated tree, env vars, hook protocol, channel storage, and task parsing reflect Suncode-owned names.

## Acceptance Criteria

- [ ] A fresh init integration test asserts `.suncode/` exists and `.trellis/` does not exist after `suncode init`.
- [ ] Path constants tests expect `.suncode/workspace`, `.suncode/tasks`, `.suncode/spec`, `.suncode/scripts`, `.suncode/agents`, and `.suncode/tasks/archive`.
- [ ] Hook and agent template tests assert generated user-facing context uses `SUNCODE_*`, `.suncode/*`, `<!-- suncode-hook-injected -->`, and `<suncode-workflow>`.
- [ ] Channel core tests assert default channel storage is under `~/.suncode/channels` and the override env vars are `SUNCODE_CHANNEL_ROOT` / `SUNCODE_CHANNEL_PROJECT`.
- [ ] Update and uninstall tests operate on `.suncode` and do not treat `.trellis` as a Suncode-owned tree.
- [ ] A regression test covers a project containing only `.trellis/` and verifies Suncode does not migrate that tree during init/update.
- [ ] `pnpm -C packages/core test`, `pnpm -C packages/cli exec vitest run --reporter=dot`, `pnpm -C packages/cli run typecheck`, and `pnpm -C packages/cli run build` pass.
- [ ] A focused grep audit over generated runtime surfaces has no non-historical `trellis`, `Trellis`, `.trellis`, `TRELLIS_`, `trellis-workflow`, or `trellis-hook` leftovers.

## Out Of Scope

- No conversion of user-owned `.trellis/` directories to `.suncode/`.
- No compatibility fallback that reads `TRELLIS_*` env vars for Suncode behavior.
- No destructive cleanup of Trellis global state such as `~/.trellis/channels`.
- No attempt to rewrite historical Trellis release manifests, archived migration notes, or fork attribution that is explicitly historical.
- Public docs-site and marketplace prose that is historical or about the upstream fork can be handled separately if it is not installed into fresh Suncode projects.

## Notes

- GitNexus impact tools are requested by project instructions, but no GitNexus MCP tools are exposed in this Codex session. Impact analysis for this task will be performed through source inspection, tests, and final diff review.
