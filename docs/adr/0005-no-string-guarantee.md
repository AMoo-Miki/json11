# 0005. The no-`String` guarantee: `StringSink` confinement + structural proof

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/raw.ts`, `src/bytes.ts`); proof in `docs/byte-mode-heap-hygiene.md`

- Refines: [0003 — Borrowed spans](./0003-borrowed-spans-raw-option.md)
- Amended by: [0013 — Fail-safe coercion](./0013-fail-safe-coercion-no-string-surface.md) — the
  "`toString()` is the single explicit hatch" provision is superseded; the
  `StringSink`-confinement core below still holds.
- Related: [0011 — Lone-surrogate / separator policy](./0011-lone-surrogate-and-separator-policy.md)

## Context

The entire reason byte mode exists is that a JS `String` is immutable, unzeroable,
and lingers on the V8 heap until GC (and is recoverable from a heap snapshot).
"The secret stays bytes" is the product. That guarantee needs to be **provable**,
not merely tested — a heap-snapshot sweep is a weak check (GC runs before capture;
node names can be truncated), so the primary evidence must be a structural
argument.

## Decision

Establish and confine a single structural invariant:

> Bytes cannot become a JS `String` without one of `String.fromCharCode`,
> `String.fromCodePoint`, `TextDecoder.prototype.decode`,
> `Buffer.prototype.toString` (or `*Slice`), or `String(…)`.

Byte mode concentrates **all** of those calls into exactly one class —
`StringSink` (`src/raw.ts:57-69`). The other sinks build no string (`ByteSink`
does byte writes only; `NULL_SINK` no-ops), and `walkString`/`handleEscape`/
`ByteWriter`/`decodeUtf8` are numeric-only. `StringSink` is instantiated in
exactly two places — `scanStringForParse(collect=true)` and
`RawString.toString()` — and **neither is on the secret-value path**: value tokens
parse with `collect=false` and are stored as `RawString`; only keys and structure
take the decoding path, and those are never secrets.

The X/Y/Z property (never created / never lingers / structurally provable) and the
line-by-line value-path walk are written up in `docs/byte-mode-heap-hygiene.md`,
which is the **primary** guarantee; `test/heapHygiene.test.ts` is corroboration
(accessor-isolation zero-call spies, a distinctive-code-point parse probe, a heap
sweep, and an in-suite positive control).

## Alternatives considered

- **Rely on the heap-snapshot test alone.** Rejected: snapshot sweeps GC before
  capture (so they're a strong "doesn't linger" / weak "was never created" check)
  and node names can be truncated. The structural confinement is what actually
  proves X; the sweep backs Y.
- **Spread `String` construction wherever convenient and audit by grep.**
  Rejected: confinement to one class makes the proof a finite, reviewable claim
  ("does the value path instantiate `StringSink`? no") instead of an open-ended
  audit on every edit.

## Consequences

- **`AGENTS.md` MANDATORY RULE #6 + Conventions #6/#7** codify the operational
  rules: no `String` on the value path, no value bytes in error messages,
  `toString()` is the only hatch, scope is values-only (keys are always strings,
  so `raw:'all'` aliases `'values'`).
- Editing `raw.ts`/`bytes.ts`/`parseBytes.ts`/`stringifyBytes.ts` requires
  re-reading the proof and re-running `npm run test:heap`. If the set of
  byte→`String` entry points, the value path, or the sink structure changes, the
  proof doc (which cites specific line ranges) and the heap test's spy list update
  in the same change.
- The positive control means a green "needle not found" is meaningful; if the
  control stops finding its needle, the suite fails loudly rather than
  green-on-broken.
