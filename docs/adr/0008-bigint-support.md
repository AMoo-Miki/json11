# 0008. BigInt parse/serialize (`withLongNumerals` / `withBigInt`)

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/parse.ts`, `src/parseBytes.ts`, `src/stringify.ts`, `src/stringifyBytes.ts`)

- Related: [0009 — JSON-compatible API](./0009-json-compatible-api-and-import-styles.md)

## Context

JSON (and JSON5) numbers are IEEE-754 doubles, so integers beyond
`Number.MAX_SAFE_INTEGER` lose precision silently. ECMAScript 11 has `BigInt`, and
JSON11's remit is "a subset of ES11", so arbitrary-precision integers are in
scope. But turning *every* large number into a `BigInt` would silently change the
type of values in existing documents and break consumers expecting `number`.

## Decision

BigInt support is **opt-in and explicit on both directions**:

- **Parse:** an integer literal with an explicit `n` suffix (`123n`, `0x10n`) is
  always a `BigInt`. A plain integer literal becomes a `BigInt` *only* when
  `options.withLongNumerals` is true **and** it exceeds the safe-integer range
  (`newNumericToken`, `src/parse.ts:839`). Otherwise it stays a `number`
  (JSON-identical, lossy precision — the documented default).
- **Serialize:** a `bigint` value serializes with the `n` suffix by default
  (`123n`); `options.withBigInt: false` drops the suffix (emitting `123`)
  (`src/stringify.ts:239`).
- The byte path mirrors both behaviors exactly (`src/parseBytes.ts:803`,
  `src/stringifyBytes.ts:121`), enforced by the differential suite.

## Alternatives considered

- **Always parse large integers as BigInt.** Rejected: silently changes value
  types in existing valid JSON documents; a consumer doing arithmetic would get a
  `TypeError` mixing `bigint` and `number`. The default must preserve
  JSON-identical behavior.
- **Always emit BigInt without the `n` suffix** (to stay valid plain JSON).
  Rejected as the default: it loses the round-trip (`stringify` then `parse`
  wouldn't recover the `bigint`), which is JSON11's value-add. `withBigInt: false`
  exists for callers who specifically need plain-JSON output.

## Consequences

- Both flags default to the JSON-compatible-where-it-must-be behavior: parse keeps
  `number` unless asked, serialize keeps the round-trippable `n` form unless asked
  otherwise.
- The `withLongNumerals` parse path catches a non-integer `RangeError` from
  `BigInt(...)` and falls back to `number` — note this currently logs via
  `console.warn` (`newNumericToken`), which is the known library-logging wart
  flagged in `AGENTS.md` gotcha #3.
- Any change to number/BigInt boundary behavior is a spec-ambiguity decision to
  surface (Convention #11), not a silent default change.
