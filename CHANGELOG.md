# JSON11 Changelog

JSON11 is an independent JSON parser/serializer. It originated as a fork of
[JSON5] but has diverged into its own library — adding BigInt support and a
byte-preserving parse/serialize mode (borrowed value spans) — and is versioned
and released independently, starting at 3.0.0.

History before 3.0.0 belongs to JSON5 and is not duplicated here; see the
[JSON5 changelog] for it.

This project follows [Semantic Versioning]; the format is based on
[Keep a Changelog].

[JSON5]: https://json5.org/
[JSON5 changelog]: https://github.com/json5/json5/blob/main/CHANGELOG.md
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/

## [3.0.0-alpha.1]

The first independent JSON11 release (forked from JSON5 v2.2.3).

### Added

- **Byte mode** — secret-preserving parse/serialize. Additive and opt-in, with no
  new runtime dependencies and no change to the existing string APIs.
  - `parse(Uint8Array, …)` parses JSON11 directly from UTF-8 bytes
    (`Uint8Array`/`Buffer`) via a bounds-checked byte parser, differential- and
    fuzz-tested against the string parser.
  - `parse(bytes, …, { raw: 'values' })` returns string values as borrowed
    `RawString` spans — escaped `span()`/`copy()` and decoded `decode()` bytes —
    without ever materializing a `String`. Materializing is a deliberate, named
    opt-in: `RawString.unsafeDecodeToString()` (one value) or the top-level
    `unsafeEncodeAsJSON(tree)` (a whole parsed tree). Keys remain JS strings, so
    `raw: 'all'` currently aliases `'values'`.
  - New top-level `unsafeEncodeAsJSON(tree)` export: deep-copies a raw-parsed tree
    into a fresh, plain JSON-encodable structure (each `RawString` →
    `unsafeDecodeToString()`), so `JSON.stringify(JSON11.unsafeEncodeAsJSON(doc))`
    is the explicit "I want JSON out" path.
  - `stringify(value, { raw: true })` returns a `Uint8Array` and injects
    `RawValue.escaped(span, quote)` (verbatim, byte-identical) or
    `RawValue.raw(bytes)` (escaped by JSON11) so values can reach the output
    buffer without becoming a `String`.
  - New `RawString` and `RawValue` exports; parser- and serializer-side escaping
    share one engine so lifted spans round-trip byte-identically.
- **BigInt** parsing and serialization.
- **ESM and UMD** build assets.

### Changed

- **Byte mode no-`String` surface is now fail-closed (breaking).** The byte→`String`
  hatch was renamed from `RawString.toString()` to `RawString.unsafeDecodeToString()`,
  because `toString` is exactly the method JavaScript calls implicitly during string
  coercion — so the "explicit hatch" leaked on `` `${rs}` ``, `String(rs)`, `'' + rs`,
  etc. Now:
  - `RawString.toString()` returns a byte-free placeholder (`[RawString length=…]`);
    `RawValue.toString()` likewise.
  - `Symbol.toPrimitive`, `valueOf`, and `toJSON` on `RawString`/`RawValue` **throw a
    `TypeError`**, so every implicit coercion and `JSON.stringify(tree)` fails loud
    instead of materializing the bytes. A raw parse returns a `RawString` for every
    string value, so `JSON.stringify` throws for **any** raw-parsed document (secret
    or not) — use `unsafeEncodeAsJSON(tree)` to opt in.
  - `RawString.source`/`start`/`end`/`quote` and `RawValue.bytes`/`preEscaped`/`quote`
    are now non-enumerable (still publicly readable), so `Object.keys`,
    `JSON.stringify`, and default `util.inspect` no longer dump the borrowed bytes.
- The UMD/browser global is `JSON11` (JSON5 exposed `JSON5`). The package is
  published as `json11`. Named exports (`parse`, `stringify`) are unchanged, so
  `import { parse } from 'json11'` works as before, and a default export is now
  also provided so `import JSON11 from 'json11'` and `import * as JSON11 from
  'json11'` bind the full API too.

### Fixed

- **Reviver now deletes array elements on `undefined`, matching `JSON.parse`
  (behavior change).** When a reviver returns `undefined` for an array element,
  that element is now deleted, leaving a genuine hole (`length` unchanged,
  `1 in arr === false`, skipped by `Object.keys`/`forEach`/`map`) — the same
  `[[Delete]]` `JSON.parse` performs. Previously the array branch left a visited
  `undefined` instead. The object branch already deleted correctly; both parsers
  (string and byte) now behave identically.

[3.0.0-alpha.1]: https://github.com/AMoo-Miki/JSON11/releases/tag/v3.0.0-alpha.1
