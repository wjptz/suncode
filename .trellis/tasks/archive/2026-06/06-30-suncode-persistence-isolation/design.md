# Suncode persistence isolation design

## Boundary

This task changes Suncode runtime ownership names, not historical Trellis content.

Primary runtime contract:

- Project workflow root: `.suncode/`
- Global channel root: `~/.suncode/channels`
- Environment variable prefix: `SUNCODE_`
- Hook marker: `<!-- suncode-hook-injected -->`
- Workflow wrapper: `<suncode-workflow>`

Trellis should remain an independent installed tool. A project that only contains `.trellis/` is not a Suncode project.

## Affected Areas

1. TypeScript CLI path constants

   `packages/cli/src/constants/paths.ts` should make `.suncode` the only workflow root. Downstream code that uses `DIR_NAMES.WORKFLOW` / `PATHS.*` should follow automatically.

2. Workflow structure creation and template extraction

   `packages/cli/src/configurators/workflow.ts` writes scripts, workflow, config, agents, workspace, tasks, and spec directories. It should continue using `PATHS.*`, but comments, template names, and any hard-coded references must be updated.

3. Generated Python scripts and shared hook templates

   Files under `packages/cli/src/templates/trellis/scripts/` and `packages/cli/src/templates/shared-hooks/` contain runtime path constants and env vars. They should use `.suncode`, `SUNCODE_CONTEXT_ID`, `SUNCODE_HOOKS`, `SUNCODE_DISABLE_HOOKS`, and Suncode protocol text.

4. Platform configurators and generated platform files

   Platform files under `packages/cli/src/templates/{claude,codex,cursor,gemini,opencode,pi,...}` and generator code in `packages/cli/src/configurators/` should refer to `.suncode` in commands, context-loading instructions, and fallback guidance.

5. Bundled Suncode skills

   `packages/cli/src/templates/common/bundled-skills/suncode-*` are installed into user projects and must describe `.suncode` paths, Suncode task scripts, Suncode env vars, and Suncode protocol markers.

6. Channel core package

   `packages/core/src/channel/internal/store/paths.ts` owns global channel storage and env overrides. Rename defaults and env vars to Suncode. Tests in `packages/core/test/channel/` should reflect the new contract.

7. CLI utilities

   Utilities such as template hash tracking, manifest pruning, uninstall scrubbers, registry config, CWD guard, workflow resolver, agent refs, and template fetcher must use `.suncode` and `SUNCODE_*` where they affect Suncode runtime.

8. Tests

   Existing tests encode `.trellis` and `TRELLIS_*` heavily. Update tests that assert current runtime behavior; keep tests for historical parsers only where the code intentionally parses older Trellis dialogue or historical release material.

## Compatibility Decision

No compatibility bridge is added.

- Suncode will not read `.trellis/` as its workflow root.
- Suncode will not read `TRELLIS_*` env vars as aliases.
- Suncode will not rename `.trellis/` to `.suncode/`.
- Trellis global channel data remains where it is and is not imported.

This makes the migration cleaner and avoids accidental data ownership conflicts for users who install both tools.

## Historical Exceptions

Some Trellis strings should remain:

- migration manifests describing old Trellis releases
- docs or changelogs explicitly about the upstream fork or historical releases
- parser tests for old conversation logs if those parsers are intentionally backward-looking
- repository attribution in README or license-adjacent material

The grep audit should therefore focus on generated runtime surfaces and current Suncode code paths, not every historical artifact in the repository.

## Risk

Risk is high because the workflow root and env prefix are cross-cutting contracts. The main failure modes are:

- one generated hook still writes `TRELLIS_CONTEXT_ID` while task scripts only read `SUNCODE_CONTEXT_ID`
- a configurator writes `.suncode/` but template hash or uninstall still expects `.trellis/`
- channel tests pass with an override but default storage still points at `~/.trellis`
- generated agent instructions mention `.trellis`, causing the user to see Trellis during normal Suncode use

The mitigation is to change the central constants first, then fix failing tests and use grep audits on generated runtime surfaces.

## Rollback

Rollback is the task commit revert. Because no data migration is implemented, rollback does not need to transform user data.
