# Hub knowledge search implementation plan

## Checklist

1. [x] Inspect latest `packages/cli/src/commands/hub/index.ts`, `skills.ts`, `types.ts`, and Hub tests before editing.
2. [x] Run GitNexus impact analysis before modifying:
   - `registerHubCommand`
   - `hubSkillPush`
   - `hubSkillPull`
   - any helper extracted from `skills.ts`
3. [x] Add TDD tests first:
   - command registration includes `knowledge`
   - `hubKnowledgeSearch()` sends vector-search POST with default `top_k`
   - custom `topK` sends requested value
   - empty query rejects without fetch
   - invalid `topK` rejects without fetch
   - disabled Hub returns disabled without fetch
4. [x] Verify the new tests fail for the expected reason.
5. [x] Extract shared agent-hub request helper:
   - create `packages/cli/src/commands/hub/agent-hub-client.ts`
   - move timeout, raw/json request, error parsing, abort handling from `skills.ts`
   - parameterize error label so messages do not say `skill package` for knowledge
6. [x] Update `packages/cli/src/commands/hub/skills.ts` to import the shared helper and keep behavior unchanged.
7. [x] Add `packages/cli/src/commands/hub/knowledge.ts`:
   - option/result interfaces
   - query normalization
   - `topK` parsing/validation helper
   - `hubKnowledgeSearch()`
8. [x] Register CLI command in `packages/cli/src/commands/hub/index.ts`:
   - `knowledge <query...>`
   - `--top-k <n>`
   - output via `runJson`
9. [x] Update `packages/cli/test/commands/hub.test.ts` imports and assertions.
10. [x] Run verification:
    - `pnpm --filter @wjptz/suncode test -- test/commands/hub.test.ts`
    - `pnpm --filter @wjptz/suncode lint`
    - `pnpm --filter @wjptz/suncode typecheck`
    - `git diff --check`
    - `node .gitnexus/run.cjs detect-changes`

## Risk Points

- Do not route `/api/agent-hub` through `/api/v1` client.
- Do not silently swallow Hub vector-search failures; the AI must know when knowledge is unavailable.
- Keep disabled Hub as a no-network path.
- Keep auth from login session only; do not use `SUNCODE_HUB_TOKEN`.
- When extracting agent-hub helper, preserve skill package upload/download tests.

## Rollback

- The change is scoped to Hub CLI modules and tests.
- If helper extraction creates unexpected churn, revert to a small dedicated `knowledge.ts` helper only after documenting why duplication is acceptable for this task.
