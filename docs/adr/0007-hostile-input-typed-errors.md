# 0007. Hostile-input posture: bounds-checked byte parser, typed errors

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/bytes.ts`, `src/raw.ts`, `src/parseBytes.ts`)

- Related: [0002 — Byte mode as a parallel module](./0002-byte-mode-parallel-module.md), [0010 — Test strategy](./0010-test-strategy-differential-fuzz-heap.md)

## Context

The byte parser reads raw, often-untrusted `Uint8Array`/`Buffer` input directly,
without the safety of first decoding to a (validated) JS `String`. Raw bytes can
be truncated mid-sequence, contain malformed/overlong/surrogate UTF-8, end in a
lone trailing backslash, present a malformed `\u`/`\x` escape, or never terminate a
string. The parser must be safe against all of it: a parser that reads out of
bounds, hangs, or returns a partial/garbage value on crafted input is a security
defect, not a quality nit.

## Decision

The byte path is **bounds-checked end to end and fails closed with typed errors**:

- `decodeUtf8` (`src/bytes.ts`) never reads at or past `limit`; it throws
  `RangeError` on any malformed / overlong / out-of-range / encoded-surrogate
  sequence, which callers convert to a typed parse error.
- `walkString` stops at `limit` and `readHex` checks `limit`, so no escape or
  string scan can run past the buffer.
- Parse errors throw `JSON11ByteError extends SyntaxError` carrying a byte
  `offset` (and the string parser throws `SyntaxError` with `lineNumber`/
  `columnNumber`). API misuse throws `TypeError` (e.g. `raw` mode on string input,
  `RawValue.escaped` with a non-quote byte, a `RawValue`/`RawString` handed to
  string-mode `stringify`).
- The guarantees — "any malformed input throws a typed error; no input causes an
  out-of-bounds read, a hang, or a partial value" — are proven by the adversarial
  and fuzz suites (`test/adversarial.test.ts`, `test/fuzz.test.ts`), which feed
  truncations, single-byte mutations, malformed UTF-8, and adversarial escape
  fragments and assert typed-error/no-crash.

## Alternatives considered

- **Decode the whole buffer to a `String` first, then reuse the string parser.**
  Rejected: it defeats byte mode's reason for existing (the secret would already be
  a `String`, ADR 0005) and shifts UTF-8 validation into `TextDecoder` with
  lossy-replacement semantics the parser can't control.
- **Best-effort parsing that returns partial results on malformed input.**
  Rejected: a partial/garbage value is more dangerous than a thrown error in a
  security context — the caller can't tell it was truncated. Fail closed, always.

## Consequences

- **`AGENTS.md` Convention #5** requires new byte-scanning code to ship with an
  adversarial test in the same change, and bans any path that returns a partial
  value, silently coerces malformed UTF-8, reads OOB, or can loop unboundedly.
- Error messages on the value path carry only offsets, never value bytes (ADR
  0005 / Convention #6), so even error reporting can't leak a secret.
- The differential suite (ADR 0010) separately ensures the bounds-checked byte
  grammar still *accepts* exactly what the string grammar accepts.
