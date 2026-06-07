# JSON11 – JSON for Humans

JSON11 is an extension to the popular [JSON] and [JSON5] file formats. With the right options, it can be used for machine-to-machine communication.

JSON11 extends the **[JSON5 Data Interchange Format](https://spec.json5.org/)** which is itself a superset of JSON (so valid JSON and JSON5 files will always be valid JSON11 files), to include some productions from [ECMAScript 11] (ES11). It's also a _subset_ of ES11, so valid JSON11 files will always be valid ES11.[*](#ecmascript-compatibility)

[JSON]: https://www.rfc-editor.org/rfc/rfc8259

[JSON5]: https://json5.org/

[ECMAScript 11]: https://262.ecma-international.org/11.0/

## Summary of Features
The following ECMAScript 11 features, which are not supported in JSON or JSON5, have been extended to JSON11.

### Numbers
- Long numerals may be parsed as BigInts.

### BigInts
- Arbitrary precision integers can be serialized.

The following ECMAScript 5.1 features, which are not supported in JSON, have been inherited from JSON5.

### Objects
- Object keys may be an ECMAScript 5.1 _[IdentifierName]_.
- Objects may have a single trailing comma.

### Arrays
- Arrays may have a single trailing comma.

### Strings
- Strings may be single quoted.
- Strings may span multiple lines by escaping new line characters.
- Strings may include character escapes.

### Numbers
- Numbers may be hexadecimal.
- Numbers may have a leading or trailing decimal point.
- Numbers may be [IEEE 754] positive infinity, negative infinity, and NaN.
- Numbers may begin with an explicit plus sign.

### Comments
- Single and multi-line comments are allowed.

### White Space
- Additional white space characters are allowed.

[IdentifierName]: https://www.ecma-international.org/ecma-262/5.1/#sec-7.6

[IEEE 754]: http://ieeexplore.ieee.org/servlet/opac?punumber=4610933

## Example
Kitchen-sink example:

```json5
{
  // comments
  unquoted: 'and you can quote me on that',
  singleQuotes: 'I can use "double quotes" here',
  lineBreaks: "Look, Mom! \
No \\n's!",
  hexadecimal: 0xdecaf,
  leadingDecimalPoint: .8675309, andTrailing: 8675309.,
  positiveSign: +1,
  trailingComma: 'in objects', andIn: ['arrays',],
  "backwardsCompatible": "with JSON",
  "longNumeral": 1186694007922679455n
}
```

## Installation and Usage
### Node.js
```sh
npm install json11
```

#### CommonJS
```js
const JSON11 = require('json11')
// named exports also work: const { parse, stringify, RawString, RawValue } = require('json11')
```

#### Modules
```js
import JSON11 from 'json11'
// or namespace: import * as JSON11 from 'json11'
// or named:     import { parse, stringify, RawString, RawValue } from 'json11'
```

> All import styles are supported: default (`import JSON11 from 'json11'`), namespace (`import * as JSON11 from 'json11'`), and named imports all bind the same API.

### Browsers
#### UMD
```html
<!-- This will create a global `JSON11` variable. -->
<script src="https://unpkg.com/json11/dist/umd/index.min.js"></script>
```

#### Modules
```html
<script type="module">
  import JSON11 from 'https://unpkg.com/json11/dist/es/index.min.mjs'
</script>
```

## API
The JSON11 API is compatible with the [JSON API].

[JSON API]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON

### JSON11.parse()
Parses a JSON11 string, constructing the JavaScript value or object described by the string. An optional reviver function can be provided to perform a transformation on the resulting object before it is returned.

#### Syntax
    JSON11.parse(text[, reviver, [options]])

#### Parameters
- `text`: The JSON11 document to parse. This may be a `string`, **or** a `Uint8Array`/`Buffer` of UTF-8 bytes (see [Byte mode](#byte-mode-borrowed-value-spans)). The `string` and `Uint8Array` overloads are intentionally kept separate rather than offered as a single `string | Uint8Array` union — a union overload would have to pin `raw: 'off'` to preserve the no-`String` guarantee — so a caller holding a `string | Uint8Array` value must narrow it to one branch before calling.
- `reviver`: If a function, this prescribes how the value originally produced by parsing is transformed, before being returned.
- `options`: An object configuring the parse. Every property is optional.

| Option | Default | Description |
| --- | --- | --- |
| `withLongNumerals` | `false` | Parse an integer larger than `Number.MAX_SAFE_INTEGER` as a `BigInt` instead of rounding it to the nearest `double`. |
| `maxNumericDigits` | `10000` | Digit-count limit for a literal that gets fed to `BigInt(...)`: an `n`-suffixed literal, or a long integer promoted by `withLongNumerals`. The base-10 to `BigInt` conversion is super-linear in the digit count, so an attacker-sized literal can stall the event loop; over the limit, parsing throws a `SyntaxError`. Plain numbers parsed to a JS `number` are untouched. |
| `maxDepth` | `1000` | Nesting limit for the reviver walk. It applies only when you pass a `reviver` (building the tree itself is iterative), and guards against a call-stack overflow on deeply nested input. Past the limit, parsing throws a `SyntaxError`. |
| `raw` | `'off'` | Byte mode, valid only when `text` is a `Uint8Array`. `'values'` returns string values as borrowed `RawString` spans instead of JS strings; keys are still decoded to strings, so `'all'` currently behaves the same as `'values'`. Passing either with a `string` throws a `TypeError`. See [Byte mode](#byte-mode-borrowed-value-spans). |

#### Examples

```js
import { parse } from 'json11'

parse('{ unquoted: 0xC0FFEE, trailing: [1, 2,] }')
// { unquoted: 12648430, trailing: [ 1, 2 ] }

// A long integer rounds to a double by default; opt in to keep it exact.
parse('9007199254740993')                                    // 9007199254740992 (rounded)
parse('9007199254740993', null, { withLongNumerals: true })  // 9007199254740993n

// The digit cap rejects an oversized BigInt literal before converting it.
parse('9'.repeat(20000) + 'n', null, { maxNumericDigits: 10000 })  // throws SyntaxError
```

#### Return value
The object corresponding to the given JSON11 text. In `raw` mode, string values are `RawString` instances rather than JS strings.

> **TypeScript note (raw mode).** The `parse` overloads do **not** rewrite nested string fields to `RawString` in raw mode, so a caller annotating `parse<{ k: string }>(bytes, null, { raw: 'values' })` is told `k: string` while at runtime `k` is a `RawString`. Type value fields you read in raw mode as `RawString` (or `string | RawString`) yourself; this is an opt-in trade-off, not a type-system change.

### JSON11.stringify()
Converts a JavaScript value to a JSON11 string, optionally replacing values if a replacer function is specified, or optionally including only the specified properties if a replacer array is specified.

#### Syntax
    JSON11.stringify(value[, replacer[, space[, options]]])
    JSON11.stringify(value[, options])

#### Parameters
- `value`: The value to convert to a JSON11 string.
- `replacer`: A function that alters the behavior of the stringification process, or an array of String and Number objects that serve as a whitelist for selecting/filtering the properties of the value object to be included in the JSON11 string. If this value is null or not provided, all properties of the object are included in the resulting JSON11 string.
- `space`: A String or Number object that's used to insert white space into the output JSON11 string for readability purposes. If this is a Number, it indicates the number of space characters to use as white space; this number is capped at 10 (if it is greater, the value is just 10). Values less than 1 indicate that no space should be used. If this is a String, the string (or the first 10 characters of the string, if it's longer than that) is used as white space. If this parameter is not provided (or is null), no white space is used.
- `options`: An object configuring the output. Every property is optional. When you use the four-argument form, `replacer` and `space` come from the positional arguments; with the two-argument form, pass them here.

| Option | Default | Description |
| --- | --- | --- |
| `replacer` | — | Same as the `replacer` parameter. |
| `space` | — | Same as the `space` parameter. |
| `quote` | auto | Quote character for strings and quoted keys (`'` or `"`). Left unset, JSON11 picks whichever quote needs fewer escapes for each string. |
| `quoteNames` | `false` | Wrap every property name in quotes. By default a key that is a valid identifier is left bare. |
| `withBigInt` | `true` | Append the `n` suffix to `BigInt` values. Set it `false` to emit the bare integer. |
| `trailingComma` | `false` | Append a trailing comma after the last member of an object or array. Only takes effect when `space` is set; single-line output never gets one. |
| `withLegacyEscapes` | `false` | Emit the JSON5 escapes `\v`, `\0`, and `\xNN` where they apply, instead of `\uNNNN`. |
| `nonFinite` | `'literal'` | How `Infinity`, `-Infinity`, and `NaN` are written (none is valid JSON). `'literal'` writes them verbatim; `'null'` writes `null`, matching `JSON.stringify`; `'throw'` raises a `TypeError`. Finite numbers are untouched. |
| `pureJson` | `false` | Produce strict, valid JSON. It is applied last and overrides the shaping options above: double quotes, quoted keys, BigInt as a bare integer (a consumer reading it as a double may lose precision), non-finite numbers as `null`, no legacy escapes, no trailing comma. `space`, `replacer`, and `maxDepth` are left as you set them. |
| `maxDepth` | `1000` | Nesting limit. The serializer recurses once per level, so this guards against a call-stack overflow; past the limit it throws a `TypeError`. |
| `raw` | `false` | Byte mode. `true` returns a `Uint8Array` of UTF-8 bytes and lets you inject `RawValue`/`RawString` nodes without materializing them as strings. See [Byte mode](#byte-mode-borrowed-value-spans). |

#### Examples

```js
import { stringify } from 'json11'

stringify({ a: 1, 'b-c': 2 })          // {a:1,'b-c':2}   (identifier keys bare, the rest quoted)
stringify({ a: 1 }, { quote: '"', quoteNames: true })  // {"a":1}

stringify('abc')                       // 'abc'
stringify("abc'")                      // "abc'"   (quote switches to avoid an escape)

stringify({ id: 9007199254740993n })                         // {id:9007199254740993n}
stringify({ id: 9007199254740993n }, { withBigInt: false })  // {id:9007199254740993}

stringify({ n: Infinity, m: NaN })                         // {n:Infinity,m:NaN}
stringify({ n: Infinity, m: NaN }, { nonFinite: 'null' })  // {n:null,m:null}
```

`trailingComma` only shows up in indented output:

```js
stringify({ a: 1 }, { space: 2, trailingComma: true })
// {
//   a: 1,
// }
```

`pureJson` forces valid JSON whatever the other options say:

```js
stringify({ 'a-b': "he'llo", big: 10n, n: NaN }, { pureJson: true })
// {"a-b":"he'llo","big":10,"n":null}
```

> **TypeScript note (`raw: true`).** The `Uint8Array` return type is selected only when `raw` is the **literal** `true`. An options object typed as `{ raw: boolean }` (computed at runtime) falls to the `string | undefined` overload even though at runtime it still returns a `Uint8Array`. Pass a literal `true`, or narrow/assert the result, when you need the `Uint8Array` type.

#### `toJSON11` / `toJSON5` / `toJSON`
When a value defines a custom serialization hook, `stringify` honors them in the order **`toJSON11` > `toJSON5` > `toJSON`** — the first one present is called and the others are ignored. (The global `JSON.stringify` only knows `toJSON`, so a value that defines both `toJSON` and `toJSON11`/`toJSON5` serializes differently under JSON11 than under `JSON`.) Both the string and byte serializers apply the same precedence. `parse` has no analogous hook ladder — it transforms results only through the standard `reviver` callback.

#### Return value
A JSON11 string representing the value, or a `Uint8Array` when `raw: true`. `RawValue`/`RawString` nodes passed to the default (string) mode throw a `TypeError`.


## Byte mode (borrowed value spans)

Byte mode parses JSON11 from a `Uint8Array` and serializes back to one. Its purpose is secret handling: you can move a string value from one document into another without that value ever becoming a JavaScript `String`. That matters because JS strings are immutable and garbage-collected, so once a secret has been a `String` you cannot zero it, and stray copies can sit on the heap until the collector runs. Byte mode keeps such values as bytes you own and can wipe.

None of this changes the existing API. `parse(string)` and a string-returning `stringify()` behave exactly as before; byte mode is opt-in through the `raw` option and the `Uint8Array` overloads, and it adds no runtime dependencies.

### Reading values as bytes

```js
import { parse, RawString } from 'json11'

const bytes = new TextEncoder().encode('{"subkey":"S3cr3t\\u0041","meta":"ok"}')
const doc = parse(bytes, null, { raw: 'values' })

doc.meta                       // RawString
doc.meta.unsafeDecodeToString() // 'ok'  (safe: not a secret)

const v = doc.subkey  // RawString; the secret never became a String
v.span()              // Uint8Array view of the *escaped* inner bytes ("S3cr3t\u0041"),
                      //   aliasing the input buffer (zero-copy)
v.copy()              // Uint8Array, a fresh copy of those escaped bytes
v.decode()            // Uint8Array of the *decoded* value bytes ("S3cr3tA"), never a String
// v.unsafeDecodeToString()  // ONLY for non-secrets: this materializes a JS String
```

#### Coercion matrix

`RawString` and `RawValue` behave identically: implicit coercion never leaks the bytes, and the only paths to a `String` are explicitly named `unsafe*` and opt-in.

| member | `RawString` | `RawValue` |
|---|---|---|
| `toString()` | returns redacted `[RawString length=N]` (no bytes) | returns redacted `[RawValue length=N]` (no bytes) |
| `[Symbol.toPrimitive]()` | **throws** `TypeError` (catches `` `${x}` ``, `String(x)`, `'' + x`, `[x].join()`, `x.toLocaleString()`) | **throws** `TypeError` |
| `valueOf()` | **throws** `TypeError` | **throws** `TypeError` |
| `toJSON()` | **throws** `TypeError` (so `JSON.stringify(rawTree)` fails loud for **any** raw-parsed tree, secret-bearing or not) | **throws** `TypeError` |

The byte-bearing fields (`RawString.source`/`start`/`end`/`quote`, `RawValue.bytes`/`preEscaped`/`quote`) are non-enumerable, so `Object.keys`, `JSON.stringify`, and the default `util.inspect` cannot dump them.

The only sanctioned doors are:

- `RawString.unsafeDecodeToString()` materializes one value to a `String`. Never call it for a secret.
- `RawString.decode()`, `.copy()`, and `.span()` return bytes, never a `String`.
- `stringify(value, { raw: true })` serializes a tree containing `RawValue` nodes to a `Uint8Array`, never a `String`.
- `JSON11.unsafeEncodeAsJSON(tree)` materializes a whole parsed tree to plain JSON values, turning every borrowed value into a `String`. Never for a secret.

To materialize on purpose, call `unsafeDecodeToString()` on a single value. To JSON-serialize a whole parsed tree, run it through `JSON11.unsafeEncodeAsJSON(doc)` first:

```js
import JSON11 from 'json11'

// Deliberate opt-in: turn a raw-parsed tree into a plain JSON-encodable value.
// UNSAFE: materializes every borrowed value as a String; never for a secret.
JSON.stringify(JSON11.unsafeEncodeAsJSON(doc))   // '{"subkey":"S3cr3tA","meta":"ok"}'
```

> Because a raw parse returns a `RawString` for **every** string value (secret or not), `JSON.stringify(doc)` throws for any raw-parsed document. Use `unsafeEncodeAsJSON(doc)` when you genuinely want JSON out.

- `span()` returns a `subarray` view that aliases the input buffer. Do not mutate it, and copy it (or `decode()` it) before you zero the input buffer.
- `decode()` performs full JSON11 string unescaping (`\uXXXX`, surrogate pairs, `\xNN`, line continuations) and returns fresh UTF-8 bytes, never a `String`.
- `RawString.decodeBytes(buf, start, end[, quote])` is a static helper to decode an inner span you obtained elsewhere.
- Object **keys** are always JS strings (JS objects require string keys), so `raw: 'all'` currently behaves like `raw: 'values'`.

### Writing values from bytes

`stringify(..., { raw: true })` returns a `Uint8Array`. To inject a value as bytes, wrap it in a `RawValue`:

```js
import { stringify, RawValue } from 'json11'

// (a) Splice an already-escaped span verbatim: byte-identical, no re-escaping.
//     Good for moving a borrowed span between documents without touching the secret.
const out1 = stringify(
  { moved: RawValue.escaped(doc.subkey.span(), doc.subkey.quote) },
  { raw: true },
)

// (b) Hand JSON11 raw (unescaped) value bytes; JSON11 escapes them itself.
const out2 = stringify(
  { token: RawValue.raw(new TextEncoder().encode("a secret with 'quotes'")) },
  { raw: true },
)
```

A `RawString` (from a raw-mode parse) can also be placed directly into the value tree in byte mode; it is injected by its escaped span.

> **Note on deep nesting.** Objects with bare-identifier keys serialize in a single streaming pass. With `quoteNames: true` (or non-identifier keys) the serializer must place each quoted key in front of its already-serialized value to stay byte-identical to the string path, which re-copies the value bytes; for deeply-nested quoted-key objects this extra byte-copying grows with depth (bounded by the `maxDepth` cap).

### Security posture

- **Hostile-input safe parsing.** The byte parser is bounds-checked and is covered by extensive negative, adversarial, differential, and fuzz tests (random buffers, single-byte mutations, truncations, malformed UTF-8 including overlong forms and encoded surrogates, adversarial escape fragments). Any malformed input throws a typed `SyntaxError`; misuse throws `TypeError`. No input causes an out-of-bounds read, hang, or partial/garbage value.
- **No accidental `String` materialization.** Secrets stay as `Uint8Array`s through parsing, extraction, and re-serialization. A `String` of a value is only ever produced through one of two deliberately-named doors: `RawString.unsafeDecodeToString()` (a single value) or the top-level `JSON11.unsafeEncodeAsJSON(tree)` (a whole parsed tree). Every implicit coercion (`` `${v}` ``, `String(v)`, `'' + v`, `[v].join()`) and `JSON.stringify` throws a `TypeError` instead, `toString()` returns a byte-free placeholder, and the byte-bearing fields are non-enumerable so a property-walking serializer cannot dump them.
- **Escape consistency by construction.** Parser-side and serializer-side escape handling share one engine, so a span lifted from one JSON11 document and spliced into another round-trips byte-identically.
- **Caller owns buffer lifetime.** `span()` aliases your input buffer; you are responsible for zeroing input/output buffers when done.


## Known limitations

These are deliberate trade-offs. None of them affects the no-`String` guarantee, the typed-error contract, or output correctness.

- **`raw: 'all'` is an alias for `raw: 'values'`.** JavaScript object keys are always `String`s, so a raw parse cannot keep keys out of `String`; only string *values* are returned as `RawString`. Put secrets in values, not keys.
- **Quoted-key deep-nest serialize cost.** With `quoteNames: true` (or non-identifier keys) the byte serializer must place each quoted key in front of its already-serialized value to stay byte-identical to the string path, which re-copies the value bytes; for deeply-nested quoted-key objects this extra byte-copying grows with depth (bounded by the `maxDepth` cap). Bare-identifier keys serialize in a single pass. See the note under [Writing values from bytes](#writing-values-from-bytes).
- **`pureJson` + BigInt.** `pureJson: true` (and the CLI `--pure-json`) emits a BigInt as a bare integer such as `10`. That is valid JSON *text*, but a consumer reading it into an IEEE-754 double may lose precision. The behavior is deliberate: it lets `pureJson` serialize a BigInt-bearing document instead of throwing the way the global `JSON.stringify` does.
- **Byte-parser error position can drift (cosmetic).** In a few cases the byte parser's reported `line`/`column` can differ slightly from the string parser's: a newline inside a string can shift the reported line; one identifier-error path can report a negative column; and one byte-parser error site reports no column. The error **type** (`SyntaxError`/`JSON11ByteError`) and all safety properties are unaffected; only the reported position may be off.
- **`U+2028`/`U+2029` advisory warning.** A raw line/paragraph separator inside a string triggers a `console.warn` advisory (the character is valid in JSON/JSON11 but not in pre-ES2019 ECMAScript). The warning text carries no value bytes.


## CLI
This package includes a CLI for converting/reformatting JSON11 documents and for validating their syntax.

### Installation
```sh
npm install --global json11
```

### Usage
```sh
json11 [options] <file>
```

If `<file>` is not provided, then STDIN is used.

The CLI parses with JSON11 and serializes with JSON11's own `stringify`. The output-shaping flags map one-to-one onto `stringify`'s options and are a thin pass-through: with no flags the output is **JSON11** (`stringify`'s defaults — bare-identifier keys where possible, the weight-chosen quote, and BigInt values with the `n` suffix), **not** strict JSON. Compose the flags to choose the flavor you want, or pass `--pure-json` for strict, valid JSON:

```sh
json11 --pure-json <file>
```

#### Options:
- `-c`, `--convert`: Convert `<file>`, writing alongside it as `<file>.json`
- `-s`, `--space <n|t|tab>`: The number of spaces to indent, or `t`/`tab` for tabs
- `--quote <'|">`: Force `'` or `"` as the string quote
- `--quote-names`: Quote object keys
- `--no-bigint-suffix`: Emit BigInt values as bare integers (no `n` suffix). The text is valid-JSON integer text; a JSON consumer that reads it as a double may lose precision
- `--trailing-comma`: Add a trailing comma (only affects output when `--space` is set)
- `--legacy-escapes`: Use legacy escape sequences (`\v`, `\0`, `\x..`)
- `--non-finite <mode>`: How to emit `Infinity`/`-Infinity`/`NaN` — `literal` (default; valid JSON11, invalid JSON), `null` (valid JSON), or `throw`
- `--pure-json`: Emit strict, valid JSON. Overrides the output-shaping flags above (double quotes, quoted keys, bare-integer BigInt, non-finite as `null`); `--space` still applies
- `-o`, `--out-file [file]`: Output to the specified file, otherwise STDOUT
- `-v`, `--validate`: Validate JSON11 but do not output anything
- `-V`, `--version`: Output the version number
- `-h`, `--help`: Output usage information

#### `Infinity`/`NaN`
By default the CLI emits `Infinity`/`-Infinity`/`NaN` literally (valid JSON11, invalid JSON). To get valid JSON from a document containing them, pass `--non-finite null` (coerces them to `null`, like the global `JSON.stringify`) or `--non-finite throw` to fail loudly instead. `--pure-json` implies `--non-finite null` as part of producing strict JSON.

## Contributing
### Development
Fork this repo and clone your fork. Install the dependencies with `npm i`.

When contributing code, please write relevant tests and run `npm test` and `npm run lint` before submitting pull requests. Please use an editor that supports [EditorConfig](http://editorconfig.org/).

### Issues
To report bugs or request features regarding this **JavaScript implementation** of JSON11, please submit an issue to **_this_ repository**.

### Security Vulnerabilities and Disclosures
To report a security vulnerability, please follow the guidelines described in our [security policy](./SECURITY.md).

## ECMAScript Compatibility
While JSON11 aims to be fully compatible with ES5, there is one exception where both JSON and JSON11 are not. Both JSON and JSON11 allow unescaped line and paragraph separator characters (U+2028 and U+2029) in strings, however ES5 does not. A [proposal](https://github.com/tc39/proposal-json-superset) to allow these characters in strings was adopted into ES2019, making JSON and JSON11 fully compatible with ES2019.

## License
MIT. See [LICENSE.md](./LICENSE.md) for details.

## Credits
JSON5 contributors did the heavy lifting.
