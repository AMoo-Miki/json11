# 0009. JSON-compatible API surface + every import style binds the same exports

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/index.ts`, `src/parse.ts`, `src/stringify.ts`, `vite.config.ts`)

- Refines: [0001 — Dependency-free multi-format build](./0001-dependency-free-multi-format-build.md)
- Related: [0003 — Borrowed spans](./0003-borrowed-spans-raw-option.md)

## Context

JSON11 is positioned as a drop-in extension of the global `JSON`: people reach for
it expecting `parse`/`stringify` to behave like `JSON.parse`/`JSON.stringify`,
just with more accepted syntax. It also ships in ESM/CJS/UMD (ADR 0001), and
consumers import it four different ways. Both the *behavior* and the *binding* need
to be predictable, or the "drop-in" promise breaks.

## Decision

- **The API mirrors the global `JSON` API.** `parse(text[, reviver[, options]])`
  and `stringify(value[, replacer[, space[, options]]])` keep `JSON`'s signatures
  and semantics: the reviver/replacer contracts, the allowlist-array form of
  `replacer`, the `space` indent cap of 10, and `toJSON` support. JSON11 extends
  (never contradicts) this: it also honors `toJSON11`/`toJSON5` (with that
  precedence over `toJSON`), adds the `options` bag, and adds byte mode (ADR
  0003).
- **Every import style binds the same surface.** `src/index.ts` provides named
  exports (`parse`, `stringify`, `RawString`, `RawValue`) *and* a default-export
  object binding the same four, so default (`import JSON11 from 'json11'`),
  namespace (`import * as JSON11`), named (`import { parse }`), and CJS
  (`require('json11')`) all work. The build forces `output.exports: 'named'`
  (`vite.config.ts`) so the default lands on `.default` consistently across
  umd/cjs/es instead of triggering a mixed-exports warning.

## Alternatives considered

- **Default export only** (the most common single-library shape). Rejected:
  breaks `import { parse } from 'json11'`, which existing JSON5 users expect.
- **Named exports only.** Rejected: breaks `import JSON11 from 'json11'` and the
  UMD global-style usage. Shipping both is cheap and removes a whole class of
  "why doesn't my import work" issues.
- **Diverge from `JSON` semantics where convenient** (e.g. a different `space`
  cap, different reviver timing). Rejected: every divergence erodes the drop-in
  promise and surprises consumers; extensions are additive only.

## Consequences

- A change that breaks `JSON`-compat behavior or any one import style is a
  **breaking change** requiring an owner decision and a CHANGELOG entry
  (`AGENTS.md` Convention #8).
- The dual export shape must be preserved in `src/index.ts` and the
  `exports: 'named'` setting in the build; the README documents all four import
  styles and they should stay tested.
- New options go in the `options` bag, not as new positional parameters, to keep
  the `JSON`-shaped positional signature stable.
