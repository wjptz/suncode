# Remaining Reference Audit

Date: 2026-06-29

Static audit command:

```bash
rtk rg -n "Trellis|trellis|TRELLIS|Mindfold|mindfold-ai|trytrellis|docs\\.trytrellis" README.md README_CN.md CONTRIBUTING.md CONTRIBUTING_CN.md COPYRIGHT .github docs-site/package.json docs-site/README.md docs-site/docs.json docs-site/index.mdx docs-site/zh/index.mdx docs-site/marketplace/index.json marketplace/README.md marketplace/index.json
```

## Classified Remaining References

### Asset filenames

- `assets/trellis.png`
- `assets/trellis-demo.gif`
- `assets/trellis-demo-zh.gif`

Classification: pending asset rename. Alt text now says Suncode; file rename is
not required for this public branding pass and may be handled later with asset
replacement.

### Upstream attribution

- README footer links to `mindfold-ai/Trellis` as upstream provenance.
- `COPYRIGHT` preserves Mindfold LLC attribution.

Classification: license-attribution. Keep.

### Current project workflow during migration

- `CONTRIBUTING.md` and `CONTRIBUTING_CN.md` still mention `.trellis/` in the
  contributor project tree.

Classification: current repo internal workflow during migration. Runtime
persistence isolation is a later task; this public branding task intentionally
does not alter project workflow directories.

### docs-site route slugs and redirects

- `docs-site/docs.json` still references existing slugs such as
  `skills-market/trellis-meta`, `showcase/trellis-cursor`,
  `contribute/trellis`, and redirect sources such as
  `/start/what-is-trellis`.

Classification: pending docs route/content rename. Renaming paths requires file
moves and broader docs navigation work. This pass changed visible metadata,
homepage content, and external links only.

### marketplace paths

- `marketplace/index.json` and `docs-site/marketplace/index.json` still point to
  existing directories such as `skills/trellis-meta`.

Classification: pending marketplace skill directory rename. Directory/path
renames belong with the marketplace/agent-interaction phase.

### GitHub publish workflow

- `.github/workflows/publish.yml` still references `@mindfoldhq/trellis` and
  `@mindfoldhq/trellis-core`.

Classification: owned by `06-29-suncode-cli-package-identity`, not this public
branding task.

## Validation

- JSON parse check passed for:
  - `docs-site/docs.json`
  - `docs-site/package.json`
  - `docs-site/marketplace/index.json`
  - `marketplace/index.json`

Command:

```bash
rtk node -e "JSON.parse(require('fs').readFileSync('docs-site/docs.json','utf8')); JSON.parse(require('fs').readFileSync('docs-site/package.json','utf8')); JSON.parse(require('fs').readFileSync('docs-site/marketplace/index.json','utf8')); JSON.parse(require('fs').readFileSync('marketplace/index.json','utf8')); console.log('json ok')"
```

Output:

```text
json ok
```
