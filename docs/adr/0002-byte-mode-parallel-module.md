# 0002. Byte mode as a parallel module, not a refactor of the string lexer

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/parseBytes.ts`, `src/stringifyBytes.ts`)

- Refines: [0001 — Dependency-free multi-format build](./0001-dependency-free-multi-format-build.md)
- Related: [0003 — Borrowed spans](./0003-borrowed-spans-raw-option.md), [0004 — One shared escape engine](./0004-one-shared-escape-engine.md)

## Context

Byte mode needs to (1) parse from `Uint8Array`/`Buffer` and (2) return a string
value's bytes without ever decoding it to a JS `String`. The existing parser
(`src/parse.ts`) is a ~1100-line state machine in one closure with ~15 shared
mutable locals. It is **code-point oriented** (`String.fromCodePoint(source.code
PointAt(pos))`) and **always builds a JS string** for every string token
(`buffer += …`), retaining no byte offsets. It is also fully green, inherited from
JSON5, and the hard constraint was "no regression to the string paths, suite stays
green untouched."

## Decision

Implement a **self-contained byte parser** (`src/parseBytes.ts`) and **byte
serializer** (`src/stringifyBytes.ts`) that re-implement the JSON11 grammar
directly over a `Uint8Array`, with byte-level primitives (bounds-checked
`decodeUtf8`, the `ByteWriter`, span recording for string tokens). The string
modules `parse.ts`/`stringify.ts` are **frozen for byte work**; they only gain
thin dispatch shims that route `Uint8Array` input / `raw` options to the byte
modules (`src/parse.ts:40-48`, `src/stringify.ts:166-176`). Grammar equivalence
between the two implementations is guaranteed **by test** (differential corpus +
fuzz), not by sharing the lexer.

## Alternatives considered

- **Option A — source-abstracted unified lexer.** Put `peek`/`read` behind an
  interface with string- and byte-backed implementations and thread a "record
  offsets, don't build a buffer" mode through the existing string/escape states.
  Rejected: highest risk to the green suite (~150–250 LOC of edits spread through
  the hottest, most security-sensitive code), and still needs invasive dual-mode
  buffering to meet the no-`String` bar. The failure mode — "did I break the
  working parser" — is worse than Option B's.
- **Option C — scoped primitives only** (byte unescaper + byte serializer +
  `RawValue`, but no byte parser). Rejected as the *primary*: it cannot meet the
  byte-input bar (the caller still needs the input as text to find spans, or keeps
  hand-writing the fragile escape-aware scanner byte mode set out to replace). It
  was surfaced as the sanctioned smaller fallback if the owner wanted to cap
  scope.

## Consequences

- **The cost is grammar duplication** (~400–500 LOC parser + ~250 LOC
  serializer). That cost is paid down entirely by the differential and fuzz tests
  (ADR 0010): if the byte path drifts from the string path, those go red. This is
  the intended safety mechanism, not an afterthought.
- The string paths stay byte-for-byte unchanged, so byte mode is purely additive
  and opt-in (ADR 0003).
- **`AGENTS.md` MANDATORY RULE #5** codifies the freeze: a byte-mode change that
  seems to require editing `parse.ts`/`stringify.ts` is a signal you're about to
  regress the string path — stop and surface.
- New byte-scanning code carries an adversarial test in the same change (ADR
  0007).
