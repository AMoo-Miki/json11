# JSON11 Changelog

JSON11 is an independent JSON parser/serializer. It originated as a fork of [JSON5] but has diverged into its own library, adding BigInt support and a byte-preserving parse/serialize mode (borrowed value spans), and is versioned and released independently, starting at 3.0.0.

History before 3.0.0 belongs to JSON5 and is not duplicated here; see the [JSON5 changelog] for it.

This project follows [Semantic Versioning]; the format is based on [Keep a Changelog].

[JSON5]: https://json5.org/
[JSON5 changelog]: https://github.com/json5/json5/blob/main/CHANGELOG.md
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/

## [Unreleased]

### Fixed

- **`bin` field declared in object form.** `package.json` now specifies `"bin": { "json11": "dist/cli.mjs" }` instead of the bare string `"./dist/cli.mjs"`, the form npm silently auto-corrected (with a warning) at publish time. No change to the installed `json11` command; it removes the publish-time warning.

## [3.0.0] - 2026-06-06

The first independent JSON11 release (forked from JSON5 v2.2.3). This is a **major** release; the breaking changes below are intentional and are collected under **Breaking**.

### Breaking

- **Reviver deletes array elements on `undefined`, matching `JSON.parse`.** When a reviver returns `undefined` for an array element, that element is now deleted, leaving a genuine hole (`length` unchanged, `1 in arr === false`, skipped by `Object.keys`/`forEach`/`map`) — the same `[[Delete]]` `JSON.parse` performs. Previously the array branch left a visited `undefined`. This changes inherited reviver output. The object branch already deleted correctly; both parsers (string and byte) now behave identically.
- **`maxDepth` nesting cap (default 1000).** Applied to the inherited string reviver walk (when a `reviver` is supplied) and both serializers: nesting deeper than the cap now throws (`SyntaxError` on parse, `TypeError` on serialize) where it previously parsed/serialized, converting an engine-level call-stack `RangeError` into a controlled, typed limit. Raise it via the `maxDepth` parse/stringify option.
- **`Stringify11Options` is now a discriminated union.** `pureJson: true` is typed mutually exclusive with the six output-shaping options it overrides (`quote`/`quoteNames`/`withBigInt`/`trailingComma`/`withLegacyEscapes`/`nonFinite`), so a TypeScript caller building an options object that sets both may now fail to typecheck. This is a type-level change only — the runtime stays lenient (`pureJson` wins at serialize time regardless).
- **Public typings use `unknown` instead of `any`.** `parse` now defaults its result to `unknown` (was `any`), and the `Reviver`/`Replacer` callbacks and `unsafeEncodeAsJSON` take and return `unknown`. A TypeScript caller that relied on the result being implicitly `any` (e.g. immediately reading a property off `parse(text)`) must now narrow, cast, or supply the type argument — `parse<MyType>(text)`. This is a type-level change only; runtime behavior is unchanged. A new exported `Space` type names the `stringify` `space`/indent parameter.
- **CLI output is now JSON11 by default.** The `json11` CLI serializes with this package's own `stringify` instead of the global `JSON.stringify`. This fixes a crash — a documented-valid BigInt input (e.g. `{ "n": 1186694007922679455n }`) previously threw `TypeError: Do not know how to serialize a BigInt` — but it also changes the no-flag default: with no output flags the CLI now emits JSON11 (bare-identifier keys, the weight-chosen quote, BigInt with the `n` suffix), not strict JSON. New output-shaping flags map one-to-one onto `stringify` options — `--quote`, `--quote-names`, `--no-bigint-suffix`, `--trailing-comma`, `--legacy-escapes` — so the invoker composes the flavor they want, or passes `--pure-json` for strict, valid JSON in one flag. `--help` now lists every accepted flag. `Infinity` and `NaN` are emitted literally by default (valid JSON11, invalid JSON); pass `--non-finite null` to coerce them for valid JSON or `--non-finite throw` to fail loudly.

### Added

- **`maxNumericDigits` parse cap (default 10000).** Bounds the super-linear base-10 → BigInt conversion against an attacker-sized literal; an over-cap literal throws a `SyntaxError`. It gates **only** the BigInt conversion path — an `n`-suffixed literal, or a long numeral promoted under `withLongNumerals`, both new in 3.0 — so it does not change inherited plain-number parsing (not breaking). Override via the `maxNumericDigits` parse option.
- **`pureJson` stringify option.** `stringify(value, { pureJson: true })` emits strict, valid JSON. It is evaluated last and overrides the other output-shaping options regardless of how they were set: double quotes, quoted property names, BigInt as a bare integer (valid JSON number text), non-finite numbers as `null`, no legacy escapes, and no trailing comma. `space`/`replacer`/`maxDepth` are left untouched. Honored by both the string and byte (`raw: true`) serializers. The CLI exposes it as `--pure-json`. Note: a BigInt is emitted as a bare integer, so a consumer reading it into an IEEE-754 double may lose precision; `pureJson` does not throw on a BigInt the way the global `JSON.stringify` does.
- **`nonFinite` stringify option.** `stringify(value, { nonFinite })` controls how the non-finite numbers `Infinity`, `-Infinity`, and `NaN` (none of which is valid JSON) are serialized: `'literal'` (default, unchanged behavior) emits them verbatim; `'null'` emits `null` instead, matching the global `JSON.stringify`, so the output is valid JSON; `'throw'` throws a `TypeError`. Honored by both the string and byte (`raw: true`) serializers. The CLI exposes it as `--non-finite <literal|null|throw>`.
- **Byte mode** — secret-preserving parse/serialize. Additive and opt-in, with no new runtime dependencies and no change to the existing string APIs.
  - `parse(Uint8Array, …)` parses JSON11 directly from UTF-8 bytes (`Uint8Array`/`Buffer`) via a bounds-checked byte parser, differential- and fuzz-tested against the string parser.
  - `parse(bytes, …, { raw: 'values' })` returns string values as borrowed `RawString` spans — escaped `span()`/`copy()` and decoded `decode()` bytes — without ever materializing a `String`. Materializing is a deliberate, named opt-in: `RawString.unsafeDecodeToString()` (one value) or the top-level `unsafeEncodeAsJSON(tree)` (a whole parsed tree). Keys remain JS strings, so `raw: 'all'` currently aliases `'values'`.
  - New top-level `unsafeEncodeAsJSON(tree)` export: deep-copies a raw-parsed tree into a fresh, plain JSON-encodable structure (each `RawString` → `unsafeDecodeToString()`), so `JSON.stringify(JSON11.unsafeEncodeAsJSON(doc))` is the explicit "I want JSON out" path.
  - `stringify(value, { raw: true })` returns a `Uint8Array` and injects `RawValue.escaped(span, quote)` (verbatim, byte-identical) or `RawValue.raw(bytes)` (escaped by JSON11) so values can reach the output buffer without becoming a `String`.
  - The byte-API factories fail closed on caller misuse: `RawValue.escaped(...)` and `RawString.decodeBytes(...)` throw `TypeError` on an invalid quote or span/offsets, rather than producing a malformed value.
  - New `RawString` and `RawValue` exports; parser- and serializer-side escaping share one engine so lifted spans round-trip byte-identically.
- **BigInt** parsing and serialization.
- **ESM and UMD** build assets.

### Changed

- **Byte mode no-`String` surface is fail-closed.** (Part of the new 3.0 byte-mode feature — not a break against any prior released contract.) The byte→`String` hatch is named `RawString.unsafeDecodeToString()`, not `RawString.toString()`, because `toString` is exactly the method JavaScript calls implicitly during string coercion — a `toString` hatch would leak on `` `${rs}` ``, `String(rs)`, `'' + rs`, etc. So:
  - `RawString.toString()` returns a byte-free placeholder (`[RawString length=…]`); `RawValue.toString()` likewise.
  - `Symbol.toPrimitive`, `valueOf`, and `toJSON` on `RawString`/`RawValue` **throw a `TypeError`**, so every implicit coercion and `JSON.stringify(tree)` fails loud instead of materializing the bytes. A raw parse returns a `RawString` for every string value, so `JSON.stringify` throws for **any** raw-parsed document (secret or not) — use `unsafeEncodeAsJSON(tree)` to opt in.
  - `RawString.source`/`start`/`end`/`quote` and `RawValue.bytes`/`preEscaped`/`quote` are now non-enumerable (still publicly readable), so `Object.keys`, `JSON.stringify`, and default `util.inspect` no longer dump the borrowed bytes.
- The UMD/browser global is `JSON11` (JSON5 exposed `JSON5`). The package is published as `json11`. Named exports (`parse`, `stringify`) are unchanged, so `import { parse } from 'json11'` works as before, and a default export is now also provided so `import JSON11 from 'json11'` and `import * as JSON11 from 'json11'` bind the full API too.
- `RawValue`'s internal fields (`bytes`/`preEscaped`/`quote`) are not part of the public type definitions (`dist/index.d.ts`/`.d.cts`). Because the whole `RawValue` surface is new in 3.0 (still in 3.x alpha) and has never shipped stable, this is the type's intended public shape, not a removal: the fields exist at runtime, unchanged and non-enumerable, with no runtime behavior change.

### Fixed

- **`RawValue.raw` escaping now matches the canonical one-engine output.** Bytes handed to `RawValue.raw(...)` are escaped through the same shared escape engine the string and byte serializers use, so an injected raw value round-trips byte-identically with a value escaped on the normal path.

### Documentation

- Documented `stringify`'s `toJSON11` > `toJSON5` > `toJSON` precedence (the first hook present wins; `JSON.stringify` only knows `toJSON`, so a value defining both serializes differently under JSON11). Honored by both serializers.
- Documented the raw-mode TypeScript caveats: parsed raw string *values* are `RawString`, not the `string` an annotation may claim; the `Uint8Array` `stringify` return is selected only for a **literal** `raw: true`; and `parse` keeps its `string` and `Uint8Array` overloads separate (no `string | Uint8Array` union overload, to preserve the no-`String` guarantee).
- Documented the full `RawString`/`RawValue` coercion matrix (`toString` redacts; `Symbol.toPrimitive`/`valueOf`/`toJSON` throw) and a consolidated **Known limitations** section (quoted-key deep-nest serialize cost; byte-parser error-position drift, cosmetic; `pureJson` + BigInt precision; `raw: 'all'` aliasing `raw: 'values'`).

[Unreleased]: https://github.com/AMoo-Miki/JSON11/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/AMoo-Miki/JSON11/releases/tag/v3.0.0
