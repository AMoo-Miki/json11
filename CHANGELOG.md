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
    without ever materializing a `String` (`toString()` stays opt-in). Keys remain
    JS strings, so `raw: 'all'` currently aliases `'values'`.
  - `stringify(value, { raw: true })` returns a `Uint8Array` and injects
    `RawValue.escaped(span, quote)` (verbatim, byte-identical) or
    `RawValue.raw(bytes)` (escaped by JSON11) so values can reach the output
    buffer without becoming a `String`.
  - New `RawString` and `RawValue` exports; parser- and serializer-side escaping
    share one engine so lifted spans round-trip byte-identically.
- **BigInt** parsing and serialization.
- **ESM and UMD** build assets.

### Changed

- The UMD/browser global is `JSON11` (JSON5 exposed `JSON5`). The package is
  published as `json11`. Named exports (`parse`, `stringify`) are unchanged, so
  `import { parse } from 'json11'` works as before, and a default export is now
  also provided so `import JSON11 from 'json11'` and `import * as JSON11 from
  'json11'` bind the full API too.

[3.0.0-alpha.1]: https://github.com/AMoo-Miki/JSON11/releases/tag/v3.0.0-alpha.1
