# 0013. Fail-safe coercion: named `unsafe*` hatches replace `toString()`

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/raw.ts`, `src/index.ts`); proof updated in `docs/byte-mode-heap-hygiene.md`

- Amends: [0005 — No-`String` guarantee](./0005-no-string-guarantee.md) — supersedes
  its "`RawString.toString()` is the one and only *explicit* hatch" provision. The
  `StringSink`-confinement core of 0005 (bytes→`String` only through one class, never
  on the value path) is unchanged.
- Related: [0003 — Borrowed spans](./0003-borrowed-spans-raw-option.md)

## Context

ADR 0005 confined all byte→`String` construction to `StringSink` and designated
`RawString.toString()` as the single **explicit** opt-in door, documented "never
call this for a secret." The premise was that materialization only happens when a
caller *deliberately types* `.toString()`.

That premise is false. `toString` is precisely the method the JavaScript runtime
invokes *implicitly* during every string coercion — `` `${rs}` ``, `String(rs)`,
`'' + rs`, `[rs].join()`, `rs.toLocaleString()` — via `ToPrimitive`. So the
"explicit hatch" and the "implicit coercion target" were the same method, and the
single most natural caller mistake (interpolating a parsed value into a log line)
decoded the secret onto the heap with no `.toString()` ever typed. Worse, the
byte-bearing fields were enumerable own properties, so `JSON.stringify(doc)`,
`console.log(doc)`, and any property-walking serializer dumped the borrowed bytes
as a rendered `String` — also without `toString`. A documented core security
promise ("a `String` is only produced via `toString()`") was therefore untrue.

## Decision

Make the default path **fail-closed** and move materialization to deliberately,
unambiguously named methods:

- **`RawString.unsafeDecodeToString(): string`** is the single byte→`String` hatch
  for one value (the old `toString()` body verbatim — same `StringSink` decode,
  lone surrogates preserved).
- **`unsafeEncodeAsJSON(tree)`** (new top-level export) is the deliberate hatch for
  a whole parsed tree: it deep-copies into a fresh, prototype-safe, plain
  JSON-encodable structure (each `RawString` → `unsafeDecodeToString()`), so
  `JSON.stringify(JSON11.unsafeEncodeAsJSON(doc))` is the explicit "I want JSON out"
  path. It never mutates the input tree.
- **`toString()`** now returns a byte-free placeholder (`[RawString length=…]`,
  built from the inner byte length only — it never decodes).
- **`Symbol.toPrimitive`, `valueOf`, and `toJSON`** throw a `TypeError`, so every
  implicit coercion and `JSON.stringify(tree)` fails loud. A custom
  `util.inspect.custom` renders the same placeholder.
- The secret-bearing fields (`RawString.source/start/end/quote`,
  `RawValue.bytes/preEscaped/quote`) are **non-enumerable** (still publicly
  readable; `quote`/`bytes`/`preEscaped` are read cross-module by the byte
  serializer, so `enumerable:false` — not `#private` — is required).

`RawValue` takes the same posture for consistency.

## Alternatives considered

- **Keep `toString()` as the hatch, add `valueOf`/`Symbol.toPrimitive` that throw.**
  Rejected: `toString()` is itself an implicit-coercion target (template literals
  and `String()` reach it before/instead of `valueOf`), so it cannot be both the
  safe default and the materialization door.
- **Doc-only ("don't interpolate a `RawString`").** Rejected: the whole point of
  byte mode is that the safe thing is the default; a security guarantee that rests
  on the caller never making a one-line logging mistake is not a guarantee.
- **`#private` fields for everything.** Rejected (fix-induced regression): the byte
  serializer reads `quote`/`bytes`/`preEscaped` cross-module, where `#private` is a
  hard error. `enumerable:false` hides them from property walks while keeping the
  documented public reads working.
- **An instance `tree.unsafeEncodeAsJSON()`.** Rejected in favor of a top-level
  helper so the deep-walk lives in one place and a bare `RawString` can't be
  confused with a tree root.

## Consequences

- **Breaking** (pre-1.0 alpha): the value hatch is renamed
  `toString()` → `unsafeDecodeToString()`; `JSON.stringify` of a raw-parsed tree now
  **throws** for *any* such document (a raw parse yields a `RawString` for every
  string value, secret or not — owner-accepted fail-closed behavior). Captured in
  the CHANGELOG and README.
- `AGENTS.md` Convention #7 is reworded to name the two hatches and the fail-closed
  posture; the heap-hygiene proof and the heap test (positive controls + the
  global-`String` spy) are updated in the same change.
- The `StringSink`-confinement argument of 0005 still holds and is the load-bearing
  proof; this ADR only changes *which named members* open the door and makes the
  unnamed paths throw.
