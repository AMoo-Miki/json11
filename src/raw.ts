/* Borrowed value spans and raw-byte injection for JSON11 byte-mode.
 *
 * `RawString` is the borrowed-span node returned by `parse(bytes, …, { raw })`:
 * it aliases the input buffer and exposes a chosen string value's bytes without
 * ever constructing a GC-managed JS String (`span`/`copy`/`decode`). It only
 * materializes a String if the caller deliberately opts in via
 * `unsafeDecodeToString` (single value) or the top-level `unsafeEncodeAsJSON`
 * helper (a whole parsed tree). Every implicit coercion (`${x}`, `String(x)`,
 * `'' + x`) and `JSON.stringify` is wired to throw instead of leaking the bytes.
 *
 * `RawValue` is the tagged wrapper the byte serializer injects verbatim
 * (pre-escaped) or escapes itself (raw bytes), so a secret can reach the output
 * buffer without becoming a String.
 *
 * Both sit on one shared escape engine (`walkString`) so parser-side and
 * serializer-side escape handling are mutually consistent by construction.
 */

import { ByteWriter, decodeUtf8 } from './bytes';

export const QUOTE_DOUBLE = 0x22;
export const QUOTE_SINGLE = 0x27;
const BACKSLASH = 0x5c;
const LF = 0x0a;
const CR = 0x0d;

/* Node renders objects through this hook; defining it lets `console.log`/
 * `util.inspect` show a byte-free placeholder instead of dumping the borrowed
 * bytes. Not a literal/unique-symbol type, so it is installed on the prototype
 * after each class body rather than as an in-class computed member. */
const NODE_INSPECT = Symbol.for('nodejs.util.inspect.custom');

// ignoreBOM: true is essential — without it TextDecoder strips a leading U+FEFF
// from every decoded run, dropping BOMs that the string parser preserves.
const textDecoder = new TextDecoder('utf-8', { ignoreBOM: true });

export type QuoteByte = 0x22 | 0x27;

export class JSON11ByteError extends SyntaxError {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`JSON11: ${message} at byte ${offset}`);
    this.name = 'JSON11ByteError';
    this.offset = offset;
  }
}

export function byteError(message: string, offset: number): JSON11ByteError {
  return new JSON11ByteError(message, offset);
}

/* A sink consumes the decoded content of a JSON string: verbatim source runs
 * plus escape-produced code points. The same walk drives a String-building sink,
 * a byte-building sink, and a validate-only (null) sink.
 */
interface Sink {
  literalRun(start: number, end: number): void;
  codePoint(cp: number): void;
}

const NULL_SINK: Sink = {
  literalRun() {},
  codePoint() {},
};

class StringSink implements Sink {
  private str = '';
  constructor(private readonly source: Uint8Array) {}
  literalRun(start: number, end: number): void {
    this.str += textDecoder.decode(this.source.subarray(start, end));
  }
  codePoint(cp: number): void {
    this.str += String.fromCodePoint(cp);
  }
  result(): string {
    return this.str;
  }
}

class ByteSink implements Sink {
  private readonly writer = new ByteWriter();
  private pendingHigh = -1;
  constructor(private readonly source: Uint8Array) {}
  literalRun(start: number, end: number): void {
    this.flushPending();
    this.writer.pushBytes(this.source, start, end);
  }
  codePoint(cp: number): void {
    if (this.pendingHigh >= 0) {
      if (cp >= 0xdc00 && cp <= 0xdfff) {
        const astral = (this.pendingHigh - 0xd800) * 0x400 + (cp - 0xdc00) + 0x10000;
        this.pendingHigh = -1;
        this.writer.pushCodePoint(astral);
        return;
      }
      this.writer.pushCodePoint(0xfffd);
      this.pendingHigh = -1;
    }
    if (cp >= 0xd800 && cp <= 0xdbff) {
      this.pendingHigh = cp;
      return;
    }
    this.writer.pushCodePoint(cp);
  }
  private flushPending(): void {
    if (this.pendingHigh >= 0) {
      this.writer.pushCodePoint(0xfffd);
      this.pendingHigh = -1;
    }
  }
  result(): Uint8Array {
    this.flushPending();
    return this.writer.toUint8Array();
  }
}

function hexValue(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  return -1;
}

function readHex(source: Uint8Array, start: number, count: number, limit: number): { value: number; next: number } {
  let value = 0;
  let i = start;
  for (let k = 0; k < count; k++) {
    if (i >= limit) {
      throw byteError('truncated unicode/hex escape', i);
    }
    const d = hexValue(source[i]);
    if (d < 0) {
      throw byteError('invalid hex digit in escape', i);
    }
    value = value * 16 + d;
    i++;
  }
  return { value, next: i };
}

/* Handle the escape sequence whose backslash was at `i - 1` (so `i` points at
 * the escape selector). Emits to `sink` and returns the index just past the
 * sequence. Bounded by `limit`. Mirrors the existing string parser's `escape`.
 */
function handleEscape(source: Uint8Array, i: number, limit: number, sink: Sink): number {
  if (i >= limit) {
    throw byteError('lone trailing backslash in string', i);
  }
  const e = source[i];
  switch (e) {
    case 0x62: sink.codePoint(0x08); return i + 1; // \b
    case 0x66: sink.codePoint(0x0c); return i + 1; // \f
    case 0x6e: sink.codePoint(0x0a); return i + 1; // \n
    case 0x72: sink.codePoint(0x0d); return i + 1; // \r
    case 0x74: sink.codePoint(0x09); return i + 1; // \t
    case 0x76: sink.codePoint(0x0b); return i + 1; // \v
    case 0x30: { // \0 (not followed by a decimal digit)
      if (i + 1 < limit && source[i + 1] >= 0x30 && source[i + 1] <= 0x39) {
        throw byteError('invalid \\0 escape followed by digit', i + 1);
      }
      sink.codePoint(0x00);
      return i + 1;
    }
    case 0x78: { // \xHH
      const { value, next } = readHex(source, i + 1, 2, limit);
      sink.codePoint(value);
      return next;
    }
    case 0x75: { // \uHHHH
      const { value, next } = readHex(source, i + 1, 4, limit);
      sink.codePoint(value);
      return next;
    }
    case LF:
      return i + 1; // line continuation
    case CR:
      if (i + 1 < limit && source[i + 1] === LF) return i + 2;
      return i + 1; // line continuation (CR or CRLF)
    case 0x31: case 0x32: case 0x33: case 0x34: case 0x35:
    case 0x36: case 0x37: case 0x38: case 0x39:
      throw byteError('invalid escape sequence (digit)', i);
    default: {
      if (e >= 0x80) {
        let dec;
        try {
          dec = decodeUtf8(source, i, limit);
        } catch (ex) {
          throw byteError((ex as Error).message, i);
        }
        if (!dec) {
          throw byteError('lone trailing backslash in string', i);
        }
        if (dec.cp === 0x2028 || dec.cp === 0x2029) {
          return i + dec.size; // line continuation
        }
        sink.literalRun(i, i + dec.size); // unnecessary escape of a multibyte char
        return i + dec.size;
      }
      sink.literalRun(i, i + 1); // unnecessary escape of an ASCII char
      return i + 1;
    }
  }
}

/* Walk the body of a JSON11 string starting at `start` (just past the opening
 * quote), feeding `sink`. Stops at an unescaped `quote` byte (returns its index)
 * or at `limit`. When `requireQuote` is true (parsing), reaching `limit` without
 * the closing quote is an unterminated-string error; when false (decoding a
 * known inner range), reaching `limit` is the normal stop.
 *
 * Throws a typed `JSON11ByteError` on any malformed input — unterminated string,
 * raw newline, bad escape, lone trailing backslash, malformed UTF-8 — and never
 * reads past `limit`.
 */
function walkString(
  source: Uint8Array,
  start: number,
  quote: number,
  sink: Sink,
  limit: number,
  requireQuote: boolean,
  onSeparator?: () => void,
): number {
  let i = start;
  let runStart = start;

  while (i < limit) {
    const b = source[i];

    if (b === quote) {
      if (i > runStart) sink.literalRun(runStart, i);
      return i;
    }

    if (b === BACKSLASH) {
      if (i > runStart) sink.literalRun(runStart, i);
      i = handleEscape(source, i + 1, limit, sink);
      runStart = i;
      continue;
    }

    if (b === LF || b === CR) {
      throw byteError('unescaped newline in string', i);
    }

    if (b < 0x80) {
      i++;
      continue;
    }

    let dec;
    try {
      dec = decodeUtf8(source, i, limit);
    } catch (ex) {
      throw byteError((ex as Error).message, i);
    }
    if (!dec) break;
    if (dec.cp === 0x2028 || dec.cp === 0x2029) {
      if (onSeparator) onSeparator();
    }
    i += dec.size;
  }

  if (requireQuote) {
    throw byteError('unterminated string', i);
  }
  if (i > runStart) sink.literalRun(runStart, i);
  return i;
}

/* Used by the byte parser: scan a string value/key starting just past the
 * opening quote, returning the index of the closing quote. With a non-null
 * `sink` (off-mode / keys) the decoded JS string is produced; with the null sink
 * (raw values) it validates only. */
export function scanStringForParse(
  source: Uint8Array,
  start: number,
  quote: number,
  collect: boolean,
  onSeparator?: () => void,
): { innerEnd: number; value?: string } {
  if (collect) {
    const sink = new StringSink(source);
    const innerEnd = walkString(source, start, quote, sink, source.length, true, onSeparator);
    return { innerEnd, value: sink.result() };
  }
  const innerEnd = walkString(source, start, quote, NULL_SINK, source.length, true, onSeparator);
  return { innerEnd };
}

/* A borrowed view over one JSON string value's escaped inner bytes. Aliases the
 * input buffer; the caller owns that buffer's lifetime and zeroing. */
export class RawString {
  /* The input buffer this value is borrowed from (aliased, not copied).
   * `declare` keeps the public type surface without emitting a class-field
   * initializer; the constructor defines it non-enumerable instead. */
  declare readonly source: Uint8Array;
  /* Inner byte offset just past the opening quote. */
  declare readonly start: number;
  /* Inner byte offset of the closing quote (exclusive end of the value). */
  declare readonly end: number;
  /* The quote byte the value was written with (0x22 `"` or 0x27 `'`). */
  declare readonly quote: QuoteByte;

  constructor(source: Uint8Array, start: number, end: number, quote: QuoteByte) {
    /* Secret-bearing state is defined non-enumerable so a property-walking
     * serializer (JSON.stringify, util.inspect's default render, a structured
     * clone, a logging framework) cannot dump the borrowed bytes. The fields
     * stay publicly readable (documented accessors; quote is read by the byte
     * serializer cross-module) — only their enumerability changes. */
    Object.defineProperty(this, 'source', { value: source, enumerable: false, writable: false });
    Object.defineProperty(this, 'start', { value: start, enumerable: false, writable: false });
    Object.defineProperty(this, 'end', { value: end, enumerable: false, writable: false });
    Object.defineProperty(this, 'quote', { value: quote, enumerable: false, writable: false });
  }

  /* (2a) Zero-copy view of the escaped inner bytes between the quotes. Aliases
   * the input buffer — do not mutate, and copy before the input is zeroed. */
  span(): Uint8Array {
    return this.source.subarray(this.start, this.end);
  }

  /* (2a) A fresh copy of the escaped inner bytes (safe to retain). */
  copy(): Uint8Array {
    return this.source.slice(this.start, this.end);
  }

  /* (2b) The decoded (unescaped) value as fresh UTF-8 bytes. Never constructs a
   * JS String. Lone surrogate escapes are emitted as U+FFFD. */
  decode(): Uint8Array {
    return RawString.decodeBytes(this.source, this.start, this.end, this.quote);
  }

  /* Materializes the value as a JS String. Never call this for a secret — the
   * resulting String is immutable, unzeroable, and lingers on the heap. This is
   * the single sanctioned byte→String door for one value; lone surrogate escapes
   * are preserved exactly as `parse(string)` produces them. */
  unsafeDecodeToString(): string {
    const sink = new StringSink(this.source);
    walkString(this.source, this.start, this.quote, sink, this.end, false);
    return sink.result();
  }

  /* Redacted, byte-free placeholder so an accidental `console.log(rs)` or an
   * explicit `rs.toString()` reveals nothing. Built from the inner byte length
   * only — never decodes the bytes. To materialize the value, call
   * `unsafeDecodeToString()` deliberately. */
  toString(): string {
    return `[RawString length=${this.end - this.start}]`;
  }

  /* Every implicit coercion funnels through ToPrimitive; throwing here makes
   * `${rs}`, `String(rs)`, `'' + rs`, `[rs].join()`, and `rs.toLocaleString()`
   * fail loud instead of silently decoding the secret. */
  [Symbol.toPrimitive](): never {
    throw new TypeError(
      'JSON11: refusing to coerce a RawString to a primitive; use .decode() for bytes or .unsafeDecodeToString() to opt in',
    );
  }

  valueOf(): never {
    throw new TypeError(
      'JSON11: refusing to coerce a RawString to a primitive; use .decode() for bytes or .unsafeDecodeToString() to opt in',
    );
  }

  /* Makes `JSON.stringify(rawTree)` fail loud rather than enumerate the bytes.
   * A raw parse returns a RawString for every string value, so this throws for
   * any raw-parsed document, secret-bearing or not. */
  toJSON(): never {
    throw new TypeError(
      'JSON11: refusing to JSON-serialize a RawString; call .decode()/.copy() for bytes, .unsafeDecodeToString() for a String, or JSON11.unsafeEncodeAsJSON(tree) to opt into JSON materialization of a whole parsed tree',
    );
  }

  /* Low-level byte-level JSON11 string unescape over an explicit inner range,
   * folded in as a static so spans obtained elsewhere can be decoded too. Never
   * constructs a String. */
  static decodeBytes(buf: Uint8Array, start: number, end: number, quote: QuoteByte = QUOTE_DOUBLE): Uint8Array {
    /* The offsets are caller-supplied; reject an out-of-range window up front so
     * a bad call fails with a clear contract error rather than a confusing
     * malformed-UTF-8 throw (from reading `undefined` past the array) or a
     * silently empty result (when start > end). */
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start > end ||
      end > buf.length
    ) {
      throw new TypeError(
        `JSON11: RawString.decodeBytes: start/end out of range for buffer length ${buf.length}`,
      );
    }
    const sink = new ByteSink(buf);
    /* Default quote is `"`; a single-quoted span legitimately contains an
     * unescaped `"`, so decoding it with the wrong terminator stops early. A
     * correctly-quoted, correctly-bounded span always walks to `end` (the framing
     * quote cannot appear unescaped inside a valid value), so a short walk means
     * the quote or the range is wrong — throw instead of returning a truncated
     * value. */
    const stop = walkString(buf, start, quote, sink, end, false);
    if (stop < end) {
      throw new TypeError(
        `JSON11: RawString.decodeBytes: span not fully consumed (stopped at offset ${stop} before end ${end}) — wrong quote for this span, or a bad range`,
      );
    }
    return sink.result();
  }
}

Object.defineProperty(RawString.prototype, NODE_INSPECT, {
  value(this: RawString): string {
    return this.toString();
  },
  enumerable: false,
  writable: true,
  configurable: true,
});

/* A tagged value the byte serializer injects without it ever becoming a String:
 * either pre-escaped inner bytes spliced verbatim between quotes, or raw
 * (unescaped) bytes that JSON11 escapes into the output using its own escaper. */
export class RawValue {
  /* @internal Read cross-module by the byte serializer; `declare` keeps the type
   * while the constructor defines it non-enumerable (so a property-walk cannot
   * dump the bytes). */
  declare readonly bytes: Uint8Array;
  /* @internal */ declare readonly preEscaped: boolean;
  /* @internal */ declare readonly quote: QuoteByte | 0;

  private constructor(bytes: Uint8Array, preEscaped: boolean, quote: QuoteByte | 0) {
    Object.defineProperty(this, 'bytes', { value: bytes, enumerable: false, writable: false });
    Object.defineProperty(this, 'preEscaped', { value: preEscaped, enumerable: false, writable: false });
    Object.defineProperty(this, 'quote', { value: quote, enumerable: false, writable: false });
  }

  /* Splice already-escaped inner bytes verbatim, wrapped in `quote`. Use this to
   * move an escaped span lifted from a JSON11 document (bar #4: byte-identical). */
  static escaped(inner: Uint8Array, quote: QuoteByte): RawValue {
    if (quote !== QUOTE_DOUBLE && quote !== QUOTE_SINGLE) {
      throw new TypeError('JSON11: RawValue.escaped quote must be 0x22 (") or 0x27 (\')');
    }
    /* Validate inner at the boundary so a frame-breaking RawValue never exists.
     * `spliceEscaped` wraps inner verbatim between two `quote` bytes without
     * inspecting it; an unescaped `quote` inside inner would terminate the value
     * early and turn the trailing bytes into document structure. Scan with the
     * shared engine and a numeric sink (no String) — if the walk does not consume
     * the whole buffer before an unescaped `quote`, the span is unsplice-able for
     * this delimiter. `walkString` itself throws on a raw newline / bad escape /
     * lone `\` / malformed UTF-8, which is the desired fail-closed behavior. */
    const stop = walkString(inner, 0, quote, NULL_SINK, inner.length, false);
    if (stop !== inner.length) {
      const quoteChar = quote === QUOTE_DOUBLE ? '"' : "'";
      throw new TypeError(
        `JSON11: RawValue.escaped: inner contains an unescaped ${quoteChar} at offset ${stop} that would break string framing`,
      );
    }
    return new RawValue(inner, true, quote);
  }

  /* Hand JSON11 raw (unescaped) value bytes; the serializer escapes them into the
   * output buffer using its own escaper. */
  static raw(bytes: Uint8Array): RawValue {
    return new RawValue(bytes, false, 0);
  }

  /* Byte-free placeholder; never decodes the bytes. */
  toString(): string {
    return `[RawValue length=${this.bytes.length}]`;
  }

  [Symbol.toPrimitive](): never {
    throw new TypeError(
      'JSON11: refusing to coerce a RawValue to a primitive; pass it to stringify(value, { raw: true }) to emit its bytes',
    );
  }

  valueOf(): never {
    throw new TypeError(
      'JSON11: refusing to coerce a RawValue to a primitive; pass it to stringify(value, { raw: true }) to emit its bytes',
    );
  }

  toJSON(): never {
    throw new TypeError(
      'JSON11: refusing to JSON-serialize a RawValue; pass it to stringify(value, { raw: true }), or JSON11.unsafeEncodeAsJSON(tree) to opt into JSON materialization',
    );
  }
}

Object.defineProperty(RawValue.prototype, NODE_INSPECT, {
  value(this: RawValue): string {
    return this.toString();
  },
  enumerable: false,
  writable: true,
  configurable: true,
});

/* Decode a RawValue's bytes to a JS String through the single `StringSink`
 * door. Defensive: a parse never yields a RawValue (it yields RawString), so
 * this only fires when a caller has placed a RawValue into a tree they then ask
 * `unsafeEncodeAsJSON` to materialize. Raw (unescaped) bytes are walked with the
 * same escaper for consistency. */
function rawValueToString(value: RawValue): string {
  const quote = value.quote === 0 ? QUOTE_DOUBLE : value.quote;
  const sink = new StringSink(value.bytes);
  walkString(value.bytes, 0, quote, sink, value.bytes.length, false);
  return sink.result();
}

/* UNSAFE: materializes every borrowed value in the tree as a JS String. Only
 * call when you deliberately intend to JSON-serialize raw-parsed data; never for
 * a tree that still holds a secret you mean to keep out of the heap.
 *
 * Returns a fresh, plain JSON-encodable structure — the input tree is never
 * mutated, so its RawStrings stay byte-only. Each RawString becomes its
 * `unsafeDecodeToString()` value; every other value (number/bigint/boolean/null)
 * passes through unchanged (BigInt remains the caller's/JSON.stringify's
 * concern). */
export function unsafeEncodeAsJSON(value: unknown): unknown {
  if (value instanceof RawString) {
    return value.unsafeDecodeToString();
  }
  if (value instanceof RawValue) {
    return rawValueToString(value);
  }
  if (Array.isArray(value)) {
    return value.map((element) => unsafeEncodeAsJSON(element));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    /* Prototype-safe rebuild: a `__proto__`/accessor key in the source becomes a
     * plain own data property on the copy instead of polluting the prototype. */
    for (const key of Object.keys(source)) {
      Object.defineProperty(out, key, {
        value: unsafeEncodeAsJSON(source[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}
