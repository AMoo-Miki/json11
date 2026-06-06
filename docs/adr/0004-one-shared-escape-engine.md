# 0004. One shared escape engine; lifted spans round-trip byte-identically

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/raw.ts`, `src/escapes.ts`, `src/stringifyBytes.ts`)

- Refines: [0002 — Byte mode as a parallel module](./0002-byte-mode-parallel-module.md)
- Related: [0003 — Borrowed spans](./0003-borrowed-spans-raw-option.md)

## Context

Byte mode's byte-identical-round-trip acceptance bar: an escaped span
lifted out of one JSON11-produced document and spliced into another must yield
**byte-identical, spec-valid JSON, by construction** — not "usually" and not
"verified case by case". If the parser-side unescaper and the serializer-side
escaper drift even slightly (a different `\v` handling, a different `\0`-before-
digit rule, a different `withLegacyEscapes` behavior), a lifted secret could be
silently corrupted or could change shape on re-emit.

## Decision

There is **one source of truth for escape semantics**, shared by both directions:

- The escape *tables* live in `src/escapes.ts` (`buildQuoteReplacements`,
  `controlEscape`, `nulFollowedByDigitReplacement`, honoring `withLegacyEscapes`).
- The *unescaper* is `walkString` + `handleEscape` in `src/raw.ts`, driven by a
  sink (so the same walk serves the String-building, byte-building, and
  validate-only sinks).
- The byte serializer builds its byte-indexed escape table from those *same*
  mappings (`buildEscapeTable` in `src/stringifyBytes.ts`), and leaf string/key
  serialization is shared with the string serializer through
  `src/serializeShared.ts` (`quoteString`, `serializeKey`).
- A span is always re-emitted with the **same quote byte** it was parsed under
  (`RawString.quote`, `RawValue.escaped(inner, quote)`).

Because escape and unescape share the table, and the quote byte is preserved, a
span lifted from one document and spliced into another is byte-identical and
re-parses to the same bytes. A differential test asserts the byte escaper's output
equals the string `quoteString` output over a large character corpus, locking the
two layers together (`test/byteStringify.test.ts`).

## Alternatives considered

- **Two independent escape tables (one per direction), kept in sync by review.**
  Rejected: "kept in sync by review" is exactly the failure mode bar #4 exists to
  eliminate. Any drift becomes a silent secret-corruption bug.
- **Always re-escape on splice (never splice verbatim).** Rejected as the default:
  re-escaping a decoded value works (`RawValue.raw`) but is not byte-identical and
  requires decoding the secret to bytes first; verbatim splice of the escaped span
  (`RawValue.escaped`) is the strongest, zero-interpretation path. Both are
  offered; verbatim is the recommended move-without-touching path.

## Consequences

- **`AGENTS.md` Convention #2** codifies this: never hand-roll a second escape
  table; the `byteStringify` differential test is the lock and must stay green.
- The quote-character caveat: splicing a
  single-quoted span verbatim into a double-quoted context keeps the span's own
  quote (safe); use `RawValue.raw(decoded)` if you need a different quote.
- Any change to escape semantics must touch `escapes.ts` (and re-run the
  differential corpus), never just one side.
