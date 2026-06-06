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

## Amendment (2026-06-06): the freeze bars byte-mode edits, not identity-preserving perf refactors

The freeze (and MANDATORY RULE #5) exists to stop a *byte-mode feature* from
leaking into and regressing the inherited string lexer/serializer. It was never
meant to forbid a general, byte-mode-agnostic performance refactor of the string
path that leaves observable behavior byte-for-byte identical.

One such refactor was taken with owner sign-off: the serializer cycle check moved
from `Array.prototype.includes` (O(depth) per node) to a `Set` (O(1)), applied
identically to both `stringify.ts` and `stringifyBytes.ts`. It is not a byte-mode
change; `Set.has` uses SameValueZero, the same object identity as `includes`, so
the differential and spec suites stay green by construction (measured +31% on
deep-nested string serialization, flat on shallow documents).

The provision this amends: "frozen" means **no byte-mode feature work and no
behavior change** to `parse.ts`/`stringify.ts` — not "no edits ever". A
behavior-preserving perf change to the string path is allowed when (1) it is not
a byte-mode feature, (2) it is proven behavior-identical by the existing
differential + spec suites, and (3) the owner signs off in the same way a string
bug fix is sanctioned. A byte-mode change that *seems* to need a string-path edit
is still the stop-and-surface signal the original rule describes.

A second, lighter touch was taken under the same provision: marking the
`QuoteContext` import in `stringify.ts` as a `type`-only import. TypeScript erases
it, so the emitted JS is byte-for-byte unchanged — no behavior to preserve, only
import hygiene. Recorded here for the same reason the perf refactor is: any edit
to a frozen file is surfaced, even one that cannot change runtime behavior.

## Amendment (2026-06-06, second): additive serializer features may land in the frozen serializer when default-preserving and mirrored in both paths

The first amendment limited frozen-path edits to changes with *no observable
behavior change*. This goes one step further, with explicit owner sign-off, and
supersedes that limit for the serializer: a **general serializer feature** (one
that belongs to `stringify` as a whole, not to byte mode) may be added to
`stringify.ts` directly, provided every condition holds:

1. **Default-preserving.** With the new option unset (or at its default), the
   serializer's output is byte-for-byte what it was before. The feature is gated
   behind a new option; the existing default path is untouched.
2. **Mirrored in both serializers.** The same feature is implemented in
   `stringifyBytes.ts` in parallel, so the parallel-module architecture (the core
   of this ADR) is preserved rather than eroded — the string serializer is not
   becoming the sole home of the logic.
3. **Locked by the differential suite.** A differential test asserts the byte
   output equals the UTF-8 of the string output for the new option, so the two
   implementations cannot drift (the same mechanism that justifies the duplication
   in the first place).
4. **Owner sign-off**, as with any frozen-path edit.

The features landed under this provision were `nonFinite` (`'literal'` default,
preserving the historical literal `Infinity`/`-Infinity`/`NaN` output; `'null'`
and `'throw'` opt-in) and `pureJson` (an off-by-default umbrella that forces the
strict-JSON option set). Both are serializer-wide options, not byte-mode concerns.

What this does **not** reopen: MANDATORY RULE #5's core signal still stands — a
*byte-mode* change that seems to need a string-path edit is still the
stop-and-surface case, and no change may regress the inherited default output.
"Frozen" now means: no byte-mode feature work, and no change to the **default**
observable behavior of `parse.ts`/`stringify.ts`. An additive, default-preserving,
both-paths-mirrored, differential-locked serializer feature is permitted with
owner sign-off; everything else about the freeze is unchanged. (`parse.ts` has no
analogous provision yet — it is untouched, and a parser feature would be its own
decision.)
