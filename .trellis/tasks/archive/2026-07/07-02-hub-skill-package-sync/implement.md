# Hub skill package pull and push implementation plan

## Checklist

1. [x] Inspect current Hub command exports and tests one more time before editing.
2. [x] Add `packages/cli/src/commands/hub/skills.ts`.
3. [x] In `skills.ts`, implement:
   - option/result interfaces
   - `.agents/skills` path resolution
   - skill name/path validation
   - recursive file collection with POSIX relative paths
   - minimal MIME inference
   - `/api/agent-hub` JSON request helper
   - `hubSkillPush()`
   - `hubSkillPull()`
4. [x] Register CLI commands in `packages/cli/src/commands/hub/index.ts`:
   - `skill-push <skill-name>`
   - `skill-pull <skill-name>`
5. [x] Extend `HubCommandStatus` only if needed. Prefer existing `submitted` and `downloaded`.
6. [x] Add Hub skill tests to `packages/cli/test/commands/hub.test.ts`.
7. [x] Run verification:
   - `pnpm --filter @wjptz/suncode test -- test/commands/hub.test.ts`
   - `pnpm --filter @wjptz/suncode typecheck`
8. [x] Run `git diff --check` and review changed files.
9. [x] Before commit, run GitNexus `detect_changes()` equivalent if available; otherwise note the tooling gap.

## Risk Points

- API base path differs from existing `/api/v1`; do not modify existing `createHubApiClient()` globally.
- `project_key` is mapped from existing `hub.projectId`; if backend later distinguishes key from id, follow-up config support may be needed.
- Pull must reject path traversal before writing.
- Push must preserve binary bytes and not normalize file content.
- Do not log signed URLs or auth headers.

## Validation Notes

- Unit tests use temp `.agents/skills/<skill-name>` directories.
- No real Hub or MinIO service should be contacted in tests.
- Full repo lint/build may be larger than this task; run targeted Hub tests and CLI typecheck at minimum.
