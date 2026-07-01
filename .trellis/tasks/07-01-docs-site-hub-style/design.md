# Design

## Boundaries

This task edits only documentation-site files and Trellis task artifacts. Runtime CLI code is used as evidence for what user-facing commands exist, but is not modified.

Target files:

- `docs-site/docs.json`
- `docs-site/styles.css`
- `docs-site/index.mdx`
- `docs-site/zh/index.mdx`
- `docs-site/start/team-hub.mdx`
- `docs-site/zh/start/team-hub.mdx`

## Mintlify Style Refresh

The docs site should rely on Mintlify's current theme system rather than carrying forward the old Trellis visual feeling. Change `theme` from `mint` to a distinct modern Mintlify theme, and pair it with a cooler Suncode palette. Keep existing logos and repository links unless they are broken.

Residual custom CSS should be limited to existing custom components and compatibility fixes. The terminal demo currently uses purple highlights; update those custom accents so they do not fight the refreshed site palette.

## Hub Guide Structure

Create one user-facing Hub guide in each language:

- English: `start/team-hub.mdx`
- Chinese: `zh/start/team-hub.mdx`

The guide should answer:

- what Hub adds to normal local Suncode
- when to use Hub versus ordinary local tasks
- safe setup sequence: initialize, login, inspect state
- how to start from Hub work at a high level
- how `<hub-state>` helps the agent choose the right path
- what not to do for ordinary local tasks

The page should use Mintlify components such as cards, callouts, and tables where useful, without becoming an API reference.

## Leakage Guard

Hub implementation details are intentionally excluded. Do not document:

- endpoint paths or HTTP methods
- auth header names or examples
- JSON request/response bodies
- token file paths or session layout
- object storage, MinIO, signed URL, or artifact upload internals
- real service hostnames

Use placeholder IDs and user commands only.

## Compatibility

Navigation remains bilingual and minimal. Add the new Hub page to the existing Start group in both languages. Do not create new top-level modules.

## Rollback

All changes are limited to docs-site configuration, CSS, and MDX. If the style choice is rejected, rollback is a small diff in `docs-site/docs.json` plus the terminal-demo accent colors in `styles.css`.
