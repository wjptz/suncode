# CLI Package Identity Implementation Plan

## Checklist

- [ ] Read `package.json`, `packages/cli/package.json`,
      `packages/core/package.json`, CLI entrypoints, and release scripts.
- [ ] Update package names and descriptions.
- [ ] Update dependency from `@mindfoldhq/trellis-core` to
      `@wjptz/suncode-core`.
- [ ] Update imports.
- [ ] Replace bin map with `suncode` only.
- [ ] Rename `bin/trellis.js` to `bin/suncode.js` if needed and update package
      references.
- [ ] Update root scripts and package filters.
- [ ] Update release/preflight/publish scripts and workflow references.
- [ ] Update tests and fixtures that assert package names/binary names.
- [ ] Run validation commands or record why they were not run.

## Likely Files

- `package.json`
- `pnpm-lock.yaml`
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/cli/bin/*`
- `packages/cli/src/cli/index.ts`
- `packages/cli/src/constants/version.ts`
- `packages/cli/src/commands/upgrade.ts`
- `packages/cli/scripts/*.js`
- `.github/workflows/publish.yml`
- package/import-related tests under `packages/cli/test/**` and
  `packages/core/test/**`

## Validation Commands

```bash
pnpm --filter @wjptz/suncode-core test
pnpm --filter @wjptz/suncode test
pnpm --filter @wjptz/suncode typecheck
pnpm test
pnpm build
rtk rg -n "@mindfoldhq/trellis|@mindfoldhq/trellis-core|\\\"trellis\\\"|\\\"tl\\\"|mindfold-ai/trellis" package.json packages .github
rtk git status --short
```
