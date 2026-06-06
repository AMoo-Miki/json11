# Byte-mode heap hygiene — the no-String guarantee on the value path

This document is the **primary** guarantee for the security property byte-mode
exists for. The tests in `test/heapHygiene.test.ts` are corroboration and
regression nets; the argument below is the proof.

## The property (X / Y / Z)

For a chosen **secret string value** carried in a JSON11 document parsed from
bytes (`{"subkey":"<secret>", …}`):

- **X — never created.** The secret value is never decoded into a JS `String` at
  any point, not transiently, not internally.
- **Y — never lingers.** After the call returns, no reachable `String` (or other
  unintended heap copy) retains the secret. The only live plaintext copies are
  byte buffers the caller owns and can zero.
- **Z — structurally provable.** The value path is a narrow, byte-only code path:
  the span accessor returns a `subarray` view aliasing the caller's input (no
  copy); the decode accessor returns a `Uint8Array` produced by byte writes only,
  never via a string.

**Scope.** Only string **values** are protected. Object **keys** are always
decoded to JS strings (JS objects require string keys), so a secret must be a
*value*, not a key. This matches the motivating consumer (`{"subkey":"secret"}`).
Numbers/bigints/booleans/null are not secrets. Two deliberately-named hatches
produce a `String` on purpose and must never be called on a secret:
`RawString.unsafeDecodeToString()` (one value) and the top-level
`unsafeEncodeAsJSON(tree)` (a whole parsed tree). These are the only doors to X
being violated. Critically they are **not** `toString`: `toString()` returns a
byte-free placeholder, and `Symbol.toPrimitive`/`valueOf`/`toJSON` throw, so every
*implicit* coercion (`${x}`, `String(x)`, `'' + x`, `[x].join()`) and
`JSON.stringify(tree)` fails loud instead of silently materializing the bytes.
The secret-bearing fields (`source`/`start`/`end`/`quote`, and
`RawValue.bytes`/`preEscaped`/`quote`) are non-enumerable, so a property-walking
serializer cannot dump them either.

## The one structural invariant everything rests on

> **There is no way to turn bytes into a JS `String` without calling one of:
> `String.fromCharCode`, `String.fromCodePoint`, `TextDecoder.prototype.decode`,
> `Buffer.prototype.toString` (or its `*Slice` variants), or `String(…)`.**

So to prove X it suffices to show that, on the value path, the secret's bytes are
never an argument to any of those. The byte-mode engine concentrates *all* of
those calls into exactly one class — `StringSink` — and the value path never
instantiates it.

### Where String construction lives (and why the value path avoids it)

`src/raw.ts` has two sinks fed by the shared `walkString` engine:

- `StringSink` (`src/raw.ts:66-78`) — the **only** place value-shaped bytes can
  become a `String`: `textDecoder.decode(...)` on literal runs (`:70`) and
  `String.fromCodePoint(cp)` on escapes (`:73`).
- `ByteSink` (`src/raw.ts:80-115`) — byte writes only (`writer.pushBytes`,
  `writer.pushCodePoint`); constructs no `String`.
- `NULL_SINK` (`src/raw.ts:61-64`) — no-ops (validate only).

`walkString` (`src/raw.ts:215-269`) and `handleEscape` (`src/raw.ts:145-203`) are
**sink-agnostic and contain zero `String` construction** — they only call
`decodeUtf8` (returns the numeric `{cp,size}`) and `readHex` (returns numbers),
and delegate output to the sink. `ByteWriter`/`decodeUtf8` in `src/bytes.ts` are
numeric byte operations only (`src/bytes.ts:12-157`).

`StringSink` is instantiated in exactly three places, **none on the secret value
path**: `scanStringForParse(collect=true)` (`src/raw.ts:283`, used for keys /
`raw:'off'`, never a value token); `RawString.unsafeDecodeToString()`
(`src/raw.ts:339`, the deliberate single-value hatch); and `rawValueToString`
(`src/raw.ts:467`), reached only from the deliberate whole-tree hatch
`unsafeEncodeAsJSON` (`src/raw.ts:481`). The value-token parse path stores a
`RawString` (`collect=false`) and never decodes it unless the caller explicitly
invokes one of those two hatches.

## Side effects on the value path

- **Error messages carry no value bytes.** The only message that ever embedded a
  value-derived byte was `decodeUtf8`'s "invalid UTF-8 lead byte" (`src/bytes.ts`);
  it now reports only the byte *position*, not the byte. Every other byte-mode
  error message contains only positions/offsets. (This only ever fired on
  malformed UTF-8, which a valid-UTF-8 secret is not — but now there is literally
  zero value-derived content in any message.)
- **`separatorWarn` is a content-keyed log, but leaks no content.** A raw
  U+2028/U+2029 *inside a value* triggers `console.warn` (`src/parseBytes.ts`,
  via `walkString`'s `onSeparator`). The message is a fixed string with no value
  content (unlike the old string parser's `separatorChar`), so it does not leak
  the secret; it is only a side-effect *keyed on* value content. Immaterial for
  ASCII/hex secrets (which contain no separators). If even the existence of this
  log is undesirable for a given value, escape the separators or strip them
  before parsing.

## The value path, line by line

### Parse (bytes → `RawString`, no `String` of the value)

1. `parse(Uint8Array, …, { raw:'values' })` dispatches to `parseBytes`
   (`src/parse.ts:40-41`).
2. A string value token: `value()` sees a quote and calls
   `scanStringToken(quoteByte, !rawValues)` → `collect=false`
   (`src/parseBytes.ts:207-209`).
3. `scanStringToken` (`src/parseBytes.ts:781-792`): `read()` consumes only the
   **quote delimiter**; the body is scanned by
   `scanStringForParse(source, pos, quoteByte, false, …)`; it returns
   `new RawString(source, startInner, innerEnd, quoteByte)`. The value body is
   **never** passed through `peek`/`read` (which would `String.fromCodePoint` it).
4. `scanStringForParse(collect=false)` (`src/raw.ts:278`) walks with `NULL_SINK`
   → validate only, no `String`.
5. The `RawString` is stored into the parent object/array as-is
   (`src/parseBytes.ts:881-887`); no stringification. The reviver path explicitly
   skips `RawString` (`src/parseBytes.ts:688`).

`peek`/`read` (`src/parseBytes.ts:735-776`) and `unicodeEscape`
(`src/parseBytes.ts:845`) *do* call `String.fromCodePoint`, but only for
structural characters (`{ } [ ] : , "` whitespace, number/literal chars) and for
**keys/identifier names** — never for a secret value body.

### Accessors

- `RawString.span()` (`src/raw.ts:319-321`): `this.source.subarray(start, end)` —
  a zero-copy view aliasing the caller's input. **(Z, span path.)**
- `RawString.copy()` (`src/raw.ts:324-326`): `this.source.slice(start, end)` — a
  fresh byte copy.
- `RawString.decode()` (`src/raw.ts:330-332`) → `RawString.decodeBytes`
  (`src/raw.ts:379-383`): `new ByteSink(buf)` + `walkString(…, sink, …, false)` +
  `sink.result()` (`ByteWriter.toUint8Array`). Byte writes only. **(Z, decode
  path.)** The whole decoded-bytes accessor is 4 lines plus the sink-agnostic
  engine; small enough to review conclusively, so no refactor was needed.

### Re-inject (move the secret out, bytes → bytes, no `String` of the value)

1. `stringify(value, { raw:true })` → `serializeToBytes` (`src/stringify.ts` →
   `src/stringifyBytes.ts:56`), which assembles the whole document in one pass
   into a single shared `ByteWriter` (`writeValue` dispatches on the resolved
   node).
2. A `RawString` value → `spliceEscaped(value.span(), value.quote)`
   (`src/stringifyBytes.ts:118-120`). `RawValue.escaped` →
   `spliceEscaped(bytes, quote)` (`:124-125`). `RawValue.raw` → `escapeRaw`
   (`:127`).
3. `spliceEscaped` (`src/stringifyBytes.ts:176-180`) writes the quote byte, the
   value bytes, and the closing quote byte straight into the shared writer (no
   intermediate buffer, no `String`). `escapeRaw`/`escapeRawInto` (`:182-249`)
   are byte operations over a **precomputed byte escape table**
   (`buildEscapeTable`, `:394-...`) that likewise write into that shared writer;
   the secret bytes are never turned into a `String`. The shared writer is a
   numeric `Uint8Array` accumulator (`src/bytes.ts`) — `pushByte`/`pushBytes`/
   `insertBefore` move bytes only and construct no `String`.

## Why Y holds

The value path creates, of the secret, only `Uint8Array`s the caller owns: the
input buffer, `span()` (a view of it), `copy()`/`decode()` outputs, and the
serialized output buffer. None is a `String`. There is therefore nothing for the
GC to keep as a hidden, unzeroable `String` copy. Once the caller drops/zeros
those buffers, no plaintext remains. (The caller owns buffer lifetime; `span()`
aliases the input, so zero the input only after you are done with the span.)

## Methodology improvements over the original test sketches

The proposed sketches were adapted and strengthened (see test comments):

1. **Accessor isolation beats the sentinel-substring spy (defeats char-by-char).**
   The substring spy can't catch a `String.fromCharCode(b)`-per-byte build (each
   call sees one char) and `+=` isn't patchable. Instead, Test B runs the
   `span()`/`decode()` accessors *in isolation* (parse done beforehand) under
   spies on **every** byte→string entry point named by the invariant
   (`fromCharCode`, `fromCodePoint`, the global `String`, `TextDecoder.decode`,
   `Buffer.prototype.toString`/`*Slice`) and asserts the call count is **zero**.
   Since bytes cannot become a string without one of those, this catches
   char-by-char, rope/`ConsString`, and `TextDecoder` alike.
2. **Distinctive-code-point probe for the parse phase.** Parsing legitimately
   stringifies structure/keys, so a zero-call assertion can't apply there.
   Instead the secret value carries distinctive code points (U+E007 BMP and
   U+10FFFD astral, present both as raw UTF-8 and as `\u` escapes) and we assert
   those code points — and the astral char's surrogate halves — are **never**
   arguments to `fromCodePoint`/`fromCharCode` during a `raw:'values'` parse.
3. **Self-defeating-sentinel fix for the heap sweep.** A `sentinel` held as a JS
   string would itself be found by the sweep (false positive). The secret is
   generated and carried as **bytes only**; the search needle is materialized
   from those bytes *after* the snapshot is captured, so it cannot pollute it.
4. **In-suite positive control.** Companion cases materialize a *different*
   secret via each explicit hatch — `RawString.unsafeDecodeToString()` and
   `unsafeEncodeAsJSON(tree)` — and assert the sweep **finds** it, proving a green
   "not found" is meaningful in this V8 build.
5. **Documented snapshot caveats.** `getHeapSnapshot()` GCs before capture (so a
   transient is collected → the sweep is a strong Y check and only a weak X
   check); `concatenated string`/`sliced string` node *names* may not carry full
   content (another reason the structural argument, not the sweep, is primary);
   string names can be truncated, so the secret is kept short (32 bytes).

## Verified environment

Node v22.19.0. `snapshot.snapshot.meta.node_fields = [type, name, id, …]`
(`type`@0, `name`@1); `node_types[0]` includes `string`, `concatenated string`,
`sliced string`; `snapshot.strings` present; `global.gc` available under
`--expose-gc`; positive control confirmed the sweep detects a reachable secret
string.
