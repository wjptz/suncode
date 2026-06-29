# CLI Package Identity Design

## Boundary

This task owns package identity and binary identity. It does not own generated
agent command names or `.suncode` persistence. Those are separate child tasks so
the rename remains reviewable.

## Target Package Graph

```text
@wjptz/suncode
  depends on workspace:* @wjptz/suncode-core

@wjptz/suncode-core
```

## Binary Strategy

Target `bin` map:

```json
{
  "suncode": "./bin/suncode.js"
}
```

No `trellis` or `tl` aliases are retained because Suncode and Trellis are
independent products.

## Import Strategy

All TypeScript imports from `@mindfoldhq/trellis-core/...` should move to
`@wjptz/suncode-core/...`.

## Release Strategy

Release scripts should validate and publish the new package names. Any comments
or messages that refer to Trellis package names should become Suncode unless
they describe historical upstream releases.

## Risk

This task can break many tests because package names are used in scripts,
fixtures, and release guards. Keep the change focused and run package/type
validation before touching agent interactions or persistence.
