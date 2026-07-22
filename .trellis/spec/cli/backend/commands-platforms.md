# `suncode platforms` Command

Machine-readable report of which AI platforms are configured and owned by
Suncode in the current project. Downstream tooling should use this command
instead of maintaining a second marker-file table that can drift when a
platform is added or its configuration directory changes.

---

## User-facing contract

```text
suncode platforms [--json]
```

- Read the configured platform set through
  `getConfiguredPlatforms(cwd)` in `configurators/index.ts`.
- Source `displayName` and `configDir` from the matching `AI_TOOLS` registry
  entry; do not hardcode platform metadata in the command.
- `--json` prints this stable schema with `JSON.stringify(..., null, 2)`:

  ```json
  {
    "platforms": [
      {
        "id": "codex",
        "displayName": "Codex",
        "configDir": ".codex"
      }
    ]
  }
  ```

- Human mode prints one `displayName (id) — configDir` entry per configured
  platform, or `No platforms configured in this project.` for an empty set.
- Both modes exit 0 for an empty set. An empty result is not an error.
- JSON output contains no ANSI escape codes.

Ownership-aware detection is part of the command contract. For a shared root
such as `.omp/`, directory existence alone is insufficient; at least one
Suncode ownership marker must exist before the platform is reported.

## Failure behavior

- On a thrown error, print `Error: <message>` and exit 1.
- When `DEBUG` or `SUNCODE_DEBUG` is set, also print the stack.
- Adding a platform requires only the registry/configurator wiring; this
  command must not grow platform-specific branches.

## Test requirements

- `--json` reports `id`, `displayName`, and `configDir` from the real registry.
- `--json` reports an empty `platforms` array with exit 0 when no platform is
  configured.
- Human output includes the display name and config directory.
- Shared-root false positives, especially a Trellis-only or user-only `.omp/`,
  remain excluded.
- The integration test spawns the built CLI because `src/cli/index.ts` has
  import-time side effects; build must run before this test.

Canonical coverage lives in
`packages/cli/test/commands/platforms.integration.test.ts`.
