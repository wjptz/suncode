# Design

## Strategy

This is a documentation migration, not a runtime migration. The work is scoped to the `docs-site` submodule and the task metadata in the main repository.

The migration uses a layered policy:

1. The docs site is intentionally reduced to two modules: Start Here and Advanced.
2. Current user paths must be Suncode-first.
3. Non-retained modules are removed instead of being partially migrated.
4. Images that would mislead current users must be removed or replaced.
5. Retained release/package mentions must reflect the published npm packages:
   - `@wjptz/suncode@0.6.6`
   - `@wjptz/suncode-core@0.6.6`

## Boundaries

### In Scope

- `docs-site/index.mdx`
- `docs-site/quickstart.mdx`
- `docs-site/zh/quickstart.mdx`
- `docs-site/start/**`
- `docs-site/advanced/resources.mdx`
- `docs-site/zh/advanced/resources.mdx`
- `docs-site/docs.json`
- image references in current navigation paths

### Out of Scope

- Keeping changelog/blog/showcase/use-case/marketplace modules in navigation.
- Runtime CLI changes.
- npm release changes.

## Module Deletion

`docs-site/docs.json` must expose only:

- English:
  - `Start Here`
  - `Advanced`
- Chinese:
  - `开始使用`
  - `进阶`

Delete or remove from navigation all other modules:

- Use Cases
- Resource Marketplace
- Community
- Showcase
- Contributing
- Tech Blog
- Changelog
- skills/spec template pages outside Advanced
- old API/reference/guide/concepts/example folders that are not part of Start Here or Advanced

## Image Handling

`docs-site/logo/light.svg` and `docs-site/logo/dark.svg` are green icon-only assets and do not contain Trellis text.

The image audit focuses on:

- `docs-site/images/hero-dark.png`
- `docs-site/images/hero-light.png`
- `docs-site/images/checks-passed.png`
- `docs-site/images/use-cases/open-typeless/*.png`
- any missing image references such as `/images/dashboard.png` or `/images/analytics.png`

Policy:

- Current quickstart/install pages should not depend on screenshots with old Trellis branding.
- Use-case screenshots should be deleted when the use-case module is deleted.
- Broken or missing image references should be removed or replaced with text.

## Navigation

`docs-site/docs.json` remains the source of truth for Mintlify navigation.

Navbar links should not point to deleted modules. Remove Changelog and Tech Blog links unless they are replaced with retained Start/Advanced pages.

## Validation

Run from `docs-site`:

```bash
pnpm lint
```

Also run targeted static checks from the main repo:

```bash
rg "@mindfoldhq/trellis|trellis init|trellis update|trellis upgrade" docs-site/index.mdx docs-site/zh/index.mdx docs-site/start docs-site/zh/start docs-site/advanced docs-site/zh/advanced docs-site/docs.json
rg "/images/|\\.png|\\.svg" docs-site -n
```

Retained pages should not contain current-install or current-command Trellis references.
