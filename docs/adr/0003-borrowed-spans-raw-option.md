# 0003. Borrowed value spans: `RawString`/`RawValue`, `raw` folded into parse/stringify

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/raw.ts`, `src/parse.ts`, `src/stringify.ts`)

- Refines: [0002 — Byte mode as a parallel module](./0002-byte-mode-parallel-module.md)
- Related: [0005 — No-`String` guarantee](./0005-no-string-guarantee.md), [0009 — JSON-compatible API](./0009-json-compatible-api-and-import-styles.md)

## Context

A consumer holds a decrypted `Buffer` shaped like `{"subkey":"secret", …}` and
must move one value into a new document without that value ever existing as a
GC-managed JS `String`. The public surface for this must be safe by *type* where
possible (so misuse is a compile error, not just a runtime throw), and must not
disturb the existing `parse(string)` / `stringify(): string` API.

## Decision

- **No separate `parseBytes`/`stringifyBytes` exports and no separate options
  types.** Byte behavior folds into the existing entries:
  - `parse(text: string | Uint8Array, reviver?, options?)` with
    `options.raw: 'off' | 'values' | 'all'`. Overloads make `raw: 'values'/'all'`
    type-valid **only** against `Uint8Array` input, so
    `parse('…', null, { raw: 'values' })` is a compile error — with a runtime
    `TypeError` backstop (a string input is already a materialized secret).
  - `stringify(value, … , options?)` with `options.raw: boolean`; overloads make
    the return type discriminate to `Uint8Array` when `raw: true`.
- **`RawString`** is the borrowed-span node returned for string *values* in raw
  mode. It aliases the input buffer (`source`, `start`, `end`, `quote`) and
  decodes nothing until asked: `span()` (zero-copy view), `copy()` (fresh escaped
  copy), `decode()` (fresh decoded value bytes), and `toString()` (the explicit,
  documented "never for a secret" hatch).
- **`RawValue`** is the tagged wrapper the byte serializer injects:
  `RawValue.escaped(inner, quote)` splices an already-escaped span verbatim
  (byte-identical), `RawValue.raw(bytes)` hands JSON11 raw bytes to escape itself.
  A `RawString` is itself accepted directly as a raw node, so lifting end-to-end
  needs no manual rewrapping.
- **Only the two public classes are added to `src/index.ts`** (`RawString`,
  `RawValue`); the byte parser/serializer stay internal, reached through
  `parse`/`stringify` + the `raw` option.

## Alternatives considered

- **Separate `parseBytes`/`stringifyBytes` public exports.** Rejected: doubles the
  public API surface and the docs, and invites consumers to reach for the byte
  path when they don't need it. Folding into `parse`/`stringify` with overloads
  keeps one mental model and makes the safe shape the default.
- **Return decoded `Uint8Array` directly instead of a `RawString` node.**
  Rejected: a node lets non-secret values stay lazy (`String(node)` only when you
  actually want the string) and carries the `quote` byte needed for byte-identical
  re-emit (ADR 0004). The node type (`RawString | …`, not `string`) is itself the
  compile-time signal that bar #2 is met.

## Consequences

- Misuse (`raw` on string input, `RawValue`/`RawString` into string-mode
  `stringify`) is caught at compile time where possible and throws a typed
  `TypeError` otherwise (`src/parse.ts:44`, `src/stringify.ts:196`).
- Keys are always JS strings (JS objects require it), so `raw: 'all'` currently
  aliases `'values'` — documented, not a bug (ADR 0005).
- The caller owns buffer lifetime: `span()` aliases the input, so copy/`decode()`
  before zeroing it. `ByteWriter.toUint8Array()` returns a right-sized copy so the
  internal store is never aliased out.
