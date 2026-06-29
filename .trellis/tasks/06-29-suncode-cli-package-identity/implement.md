# CLI Package Identity Implementation Plan

## Checklist

- [x] Read `package.json`, `packages/cli/package.json`,
      `packages/core/package.json`, CLI entrypoints, and release scripts.
- [x] Update package names and descriptions.
- [x] Update dependency from `@mindfoldhq/trellis-core` to
      `@wjptz/suncode-core`.
- [x] Update imports.
- [x] Replace bin map with `suncode` only.
- [x] Rename `bin/trellis.js` to `bin/suncode.js` if needed and update package
      references.
- [x] Update root scripts and package filters.
- [x] Update release/preflight/publish scripts and workflow references.
- [x] Update tests and fixtures that assert package names/binary names.
- [x] Run validation commands or record why they were not run.

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

## Validation Results

- `pnpm --filter @wjptz/suncode-core test` passed: 17 files / 297 tests.
- `pnpm --filter @wjptz/suncode test` passed: 51 files / 1277 tests.
- `pnpm --dir packages/cli run typecheck` passed.
- `pnpm test` passed: core + CLI suites.
- `pnpm lint` passed.
- `pnpm typecheck` passed with native `pnpm`; `rtk pnpm typecheck` printed
  `TypeScript: No errors found` but returned a wrapper-level non-zero status.
- `pnpm build` passed.
- CLI smoke after build passed:
  - `node packages/cli/bin/suncode.js --version`
  - `node packages/cli/bin/suncode.js --help`
  - `node packages/cli/bin/suncode.js init --help`
  - `node packages/cli/bin/suncode.js update --help`
- `node packages/cli/scripts/release-preflight.js check-versions` passed.
- `node packages/cli/scripts/release-preflight.js verify-packed-cli` passed.
- `node packages/cli/scripts/release-preflight.js publish-plan` was attempted
  and failed on a real npm registry `npm view @wjptz/suncode-core@0.6.5`
  timeout (`ETIMEDOUT`). This is an external registry/network check; local
  package/version/packing checks passed.
- Static audit for old package names passed for package/runtime/release scope;
  remaining `trellis.json` occurrences are platform-generated config filenames
  and intentionally out of scope for this task.
- Static audit confirmed package bin aliases no longer expose `trellis` or `tl`.
