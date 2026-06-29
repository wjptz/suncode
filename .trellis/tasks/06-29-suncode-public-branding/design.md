# Public Branding Design

## Boundary

This task changes only public-facing copy, links, metadata, and navigation. It
does not change package identity, CLI behavior, runtime directory names, command
generation, template fetching, or persistence protocols.

## Branding Targets

- Product name: `Suncode`
- npm install copy: `npm install -g @wjptz/suncode`
- CLI command copy: `suncode`
- Docs repository target: `wjptz/suncode-docs`
- Marketplace repository target: `wjptz/suncode-marketplace`
- Docs domain: unresolved. Avoid hard-coding a permanent docs domain.

## Edit Strategy

- Current product pages should say Suncode.
- Upstream historical pages may keep Trellis when they describe historical
  releases or original provenance.
- Legal/attribution sections should preserve upstream attribution and add
  Suncode fork attribution.
- Links to `docs.trytrellis.app` should be removed from current product docs or
  replaced with temporary repository links until a Suncode docs domain exists.
- Links to `github.com/mindfold-ai/Trellis` should not be primary product links
  after this task, except in attribution/upstream references.

## Risk

The biggest risk is mixing branding with behavior changes. Package names, CLI
binary mappings, generated command names, and `.suncode` runtime paths belong to
later child tasks.
