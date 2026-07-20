# Suncode Fork Boundaries For Trellis Adoption

Read this file before classifying or implementing any official Trellis change.

## Official Source Identity

- Official repository: `https://github.com/mindfold-ai/Trellis.git`.
- Expected local remote: `upstream`.
- Store fetched official release refs under `refs/remotes/upstream/releases/<tag>`.
- Treat the peeled official tag commit as release identity. Local Suncode tags with the same name are unrelated identities.
- The common fork baseline is official `v0.6.5` at `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba`.

## Runtime Identity Must Stay Isolated

Translate upstream behavior into the active Suncode contract:

| Official Trellis surface | Suncode surface |
| --- | --- |
| `.trellis` product runtime data | `.suncode` |
| `TRELLIS_*` runtime variables | `SUNCODE_*` |
| `@mindfoldhq/trellis*` packages | `@wjptz/suncode*` |
| Trellis managed blocks | Suncode managed blocks |
| `/trellis...` generated commands | `/suncode...` generated commands |
| Trellis-named platform assets | Suncode-named platform assets |

The repository's own `.trellis/` directory is its development workflow state. It is not a compatibility bridge and must not be mass-renamed, migrated, or treated as Suncode product runtime data.

Suncode must not read, migrate, rewrite, delete, or claim ownership of user Trellis runtime data, `TRELLIS_*` variables, Trellis managed blocks, or `~/.trellis/channels`.

## Shared Platform Roots Need Ownership Evidence

Directories owned by an AI platform can contain Trellis, Suncode, and user files together. Directory existence alone is never proof of Suncode ownership.

For `.omp` in particular:

- Detect Suncode configuration through Suncode-namespaced assets or the Suncode manifest.
- Update or uninstall only manifest-owned or uniquely Suncode-named files.
- Preserve Trellis and user commands, skills, agents, extensions, and settings.
- Do not remove the `.omp` root merely because Suncode assets were removed.
- Do not model OMP as Pi persistence. Require an official stable disk root and record schema before adding an OMP memory adapter.

Apply the same ownership reasoning to migrations, legacy platform paths, generated settings, and structured-file scrubbers.

## Preserve Fork-Specific Capabilities

Do not mechanically overwrite or remove these Suncode adaptations while applying upstream behavior:

- Hub and Agent Hub collaboration surfaces.
- Chinese planning artifacts and the local Trellis planning gates.
- Suncode workflow/spec injection and session-scoped task identity.
- Suncode channel and cross-session memory extensions.
- Pull-based platform integration behavior, including ZCode adaptations.
- OMP ownership-aware detection and Suncode-namespaced generated assets.

An upstream file is evidence, not a replacement template. Reconcile each behavior with current code and tests.

## Default Exclusions

Exclude these unless a review proves they contain a required product behavior:

- Upstream version numbers, tags, release manifests, and npm package identity.
- Upstream docs-site or marketplace submodule pointers.
- Upstream journals, active/archived task records, dogfood configuration, screenshots, and QR codes.
- Any automatic `.trellis` to `.suncode` migration or Trellis compatibility alias.
- Whole-tag merges and whole-range cherry-picks.

Record exclusions in the adoption matrix; do not silently discard commits.

## Required Review Questions

For every candidate behavior, answer:

1. Which user problem or invariant does it address?
2. Is the behavior already present under a different Suncode implementation?
3. Which Suncode identity, ownership, and persistence transformations are required?
4. What local fork capability could a mechanical transplant overwrite?
5. Which success, failure, mixed-ownership, and cross-platform cases prove the adaptation?
6. Is the result worth adopting now, intentionally deferring, or rejecting permanently?
