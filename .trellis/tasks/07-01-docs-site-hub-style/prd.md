# Update docs site style and Hub guide

## Goal

Refresh the Suncode Mintlify docs site so it no longer visually inherits the older Trellis-style presentation, and add user-facing Hub documentation that explains how to use Hub without exposing internal service APIs, authentication headers, payloads, signed storage details, or deployment endpoints.

## Confirmed Facts

- `docs-site` is a Mintlify site configured by `docs-site/docs.json`.
- Current navigation is intentionally small: English `Start Here` / `Advanced`, Chinese `开始使用` / `进阶`.
- Current docs site theme is `mint`, with green brand colors in `docs-site/docs.json`.
- `docs-site/styles.css` still contains older purple terminal-demo accents that visually read like the previous Trellis site.
- Existing Hub CLI commands include user-facing commands such as `suncode hub init`, `suncode hub login`, `suncode hub logout`, `suncode hub state`, and `suncode hub pull`.
- Internal Hub implementation and prior task artifacts include service endpoints, auth headers, payload shapes, token/session details, and artifact transport details that must not be copied into public docs.
- `docs-site` is bilingual. New user-facing MDX content must be mirrored under `docs-site/zh/` and added to both navigation trees.

## Requirements

- R1. Update Mintlify configuration so the docs site uses a fresh theme and visual identity instead of the previous Trellis-style look.
- R2. Keep Suncode branding and existing repository/package links intact.
- R3. Update local custom CSS only where needed to align residual custom components with the new site style.
- R4. Add an English Hub guide under `Start Here`.
- R5. Add a Chinese Hub guide under `开始使用` with matching structure and navigation.
- R6. Hub docs must explain user workflow and safe usage boundaries:
  - what Hub is for
  - when to use it
  - initialization
  - login/logout
  - state checking
  - pulling or selecting Hub work
  - avoiding Hub task submission commands for ordinary local tasks
- R7. Hub docs must not expose internal details:
  - no HTTP method/path examples
  - no API endpoint URLs
  - no auth header examples
  - no request/response payload schema
  - no token/session storage layout
  - no MinIO, signed URL, object storage, or secret examples
  - no real service hostnames
- R8. Existing docs navigation must remain focused on `Start Here` / `Advanced` and `开始使用` / `进阶`; do not reintroduce deleted modules.
- R9. Preserve user-owned unrelated working-tree changes.

## Acceptance Criteria

- [x] `docs-site/docs.json` no longer uses the old `mint` theme.
- [x] `docs-site/docs.json` keeps Suncode name, links, logo, repository, bilingual navigation, and current small information architecture.
- [x] `docs-site/start/team-hub.mdx` exists and appears in English navigation.
- [x] `docs-site/zh/start/team-hub.mdx` exists and appears in Chinese navigation.
- [x] Homepage cards expose the Hub guide in both English and Chinese.
- [x] New Hub pages contain only user-facing commands and conceptual guidance.
- [x] Static grep confirms no new Hub page contains internal API paths, auth headers, tokens, signed URL, MinIO, or payload schema details.
- [x] `pnpm lint` in `docs-site` passes, or the first real failure is recorded.
- [x] Main repo dirty files that predated this task (`README.md`, `README_CN.md`) remain untouched.

## Out of Scope

- CLI runtime behavior changes.
- Publishing or deploying the docs site.
- Adding a public API reference for Hub.
- Reintroducing changelog, blog, marketplace, showcase, or other removed docs modules.
