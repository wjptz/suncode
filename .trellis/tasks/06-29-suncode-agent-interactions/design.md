# Suncode Agent Interactions Design

## Boundary

This task changes generated AI interaction names only. It does not rename the
underlying project persistence directory or protocol names yet. The practical
boundary is:

- Current Suncode interaction surface: command references, generated command
  paths, skill IDs, bundled skill IDs, sub-agent IDs, workflow prompt names, and
  agent-facing prose that instructs a user or model which Suncode command,
  skill, or agent to invoke.
- Deferred persistence/protocol surface: `.trellis/`, `.trellis/scripts/`,
  `.trellis/spec/`, `.trellis/workflow.md`, `.trellis/.template-hashes.json`,
  `TRELLIS_*` env vars, `TRELLIS:START` markers, hook injection markers, and
  historical migration manifests.

The result is a staged state: new Suncode-generated interactions say Suncode,
while internal storage may still be `.trellis` until
`suncode-persistence-isolation`.

## Naming Contract

Use the existing per-platform shape and replace only the Trellis interaction
namespace:

| Surface | Current | Target |
| --- | --- | --- |
| Colon slash command | `/trellis:finish-work` | `/suncode:finish-work` |
| Hyphen slash command | `/trellis-finish-work` | `/suncode-finish-work` |
| Reasonix skill command | `/skill trellis-check` | `/skill suncode-check` |
| Workflow skill directory | `trellis-check/SKILL.md` | `suncode-check/SKILL.md` |
| Bundled skill directory | `trellis-meta/SKILL.md` | `suncode-meta/SKILL.md` |
| Sub-agent name | `trellis-implement` | `suncode-implement` |
| Product CLI invocation in generated prose | `trellis channel` | `suncode channel` |

Do not change platforms whose current command style is intentionally unprefixed
except where the generated file or frontmatter currently includes `trellis-*`.
For example, Kilo and Antigravity may keep unprefixed workflow invocation style
but their skill directories should still use `suncode-*`.

## Source Areas

Primary implementation areas:

- `packages/cli/src/types/ai-tools.ts`: command-reference prefix type and
  per-platform `cmdRefPrefix` values.
- `packages/cli/src/configurators/shared.ts`: neutral placeholder wording,
  skill and command frontmatter wrappers, `trellis-*` prefix construction,
  bundled skill collection, sub-agent detection, and pull-based prelude prose.
- `packages/cli/src/configurators/*.ts`: platform-specific write paths and
  collect-template paths.
- `packages/cli/src/templates/common/`: shared commands, workflow skills, and
  bundled skills.
- `packages/cli/src/templates/*/agents`, `*/droids`, hooks, settings, and
  platform `index.ts` files: generated sub-agent names and path metadata.
- `packages/cli/src/templates/trellis/workflow.md`: generated workflow text
  that routes agents to skills, commands, and sub-agents.
- `packages/cli/src/templates/trellis/scripts/common/cli_adapter.py`: generated
  command path helpers and platform fallback detection.
- `packages/cli/test/**`: integration, configurator, template, and regression
  expectations for generated paths and agent names.

## Update Strategy

1. Prefer targeted symbolic constants and helper changes over broad global
   replacement.
2. Rename template files and directories where their generated target path is an
   interaction path. Keep `.trellis` template directory and script paths for the
   later persistence task.
3. Update init write paths and update collect paths together so template hashes
   stay byte-identical.
4. Update tests that assert current generated behavior. Keep tests for
   historical parsing only when they are explicitly about legacy Trellis data.
5. Do not create migration entries that rename user files from `trellis-*` to
   `suncode-*`. Existing Trellis content remains Trellis-owned.

## Compatibility and Migration

No Trellis compatibility is retained for Suncode interactions. The new generated
surface is Suncode-only. At the same time, Suncode must not convert existing
Trellis installations:

- No alias commands such as `/trellis:continue`.
- No generated sibling copies under old Trellis command paths.
- No migration manifest that rewrites user command or skill files.
- No delete/prune step aimed at old Trellis interaction files.

Because `.suncode` persistence is deferred, a user manually running the current
Suncode CLI against an existing Trellis project is still ambiguous at the
persistence layer. This task must not try to solve that ambiguity with partial
migration logic; the later isolation task owns it.

## Validation Design

Validation should cover three layers:

- Static audit: search generated interaction sources for old Trellis command,
  skill, and agent names and classify remaining hits.
- Unit/template tests: update platform tests for expected generated paths,
  frontmatter names, sub-agent names, and command reference placeholders.
- Package verification: run CLI tests and typecheck after implementation.

If a full suite is too noisy during iteration, run targeted affected tests
first, then finish with the package-level commands in `implement.md`.
