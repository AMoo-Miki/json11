/* Internal byte-output serializer for JSON11 byte-mode.
 *
 * Reached through `stringify(value, …, { raw: true })`. It mirrors the string
 * serializer's structure/formatting exactly — leaf strings and keys go through
 * the same shared `quoteString`/`serializeKey` helpers, so for any value without
 * raw nodes the byte output is byte-identical to the UTF-8 encoding of the string
 * output (bar #4). Where it differs: it recognizes `RawValue`/`RawString` nodes
 * and injects their bytes directly (pre-escaped spliced verbatim, or raw bytes
 * escaped with JSON11's own escaper), so a secret reaches the buffer without ever
 * becoming a JS String.
 *
 * Not a public export.
 */

import { ByteWriter, decodeUtf8 } from './bytes';
import { controlEscape } from './escapes';
import { QuoteContext, quoteString, serializeKey, chooseQuote } from './serializeShared';
import { RawString, RawValue, QUOTE_DOUBLE, QUOTE_SINGLE } from './raw';

export type SerializeConfig = {
  gap: string,
  trailingComma: string,
  quoteContext: QuoteContext,
  quoteNames: boolean,
  replacer?: (this: any, key: string, value: any) => any,
  propertyList?: string[],
  withBigInt?: boolean,
  maxDepth: number,
};

const textEncoder = new TextEncoder();
const enc = (s: string): Uint8Array => textEncoder.encode(s);

/* ASCII byte literals for the structural tokens and the three keyword constants.
 * Writing these straight into the shared buffer avoids a TextEncoder call per
 * occurrence (the dominant constant-factor cost of the old per-fragment encode).
 */
const BYTE_LBRACE = 0x7b; /* { */
const BYTE_RBRACE = 0x7d; /* } */
const BYTE_LBRACKET = 0x5b; /* [ */
const BYTE_RBRACKET = 0x5d; /* ] */
const BYTE_COLON = 0x3a; /* : */
const BYTE_COMMA = 0x2c; /* , */
const BYTE_SPACE = 0x20; /*   */
const BYTE_NEWLINE = 0x0a; /* \n */
const NULL_BYTES = enc('null');
const TRUE_BYTES = enc('true');
const FALSE_BYTES = enc('false');

/* A sentinel for a member that produces no output (a function/symbol/undefined
 * value after the toJSON ladder + replacer). The resolve step returns it so the
 * caller can decide — *before writing anything* — whether to emit a member
 * (object: skip entirely; array: write null). */
const SKIP = Symbol('skip');

export function serializeToBytes(value: any, config: SerializeConfig): Uint8Array | undefined {
  const { gap, trailingComma, quoteContext, quoteNames, replacer, propertyList, withBigInt, maxDepth } = config;
  const stack: any[] = [];
  const gapBytes = enc(gap);
  const pretty = gap !== '';

  const escapeTable = buildEscapeTable(quoteContext);
  const writer = new ByteWriter();

  const nameSerializer = (key: string): Uint8Array =>
    enc(quoteNames ? quoteString(key, quoteContext) : serializeKey(key, quoteContext));

  const root = resolveValue('', { '': value });
  if (root === SKIP) {
    return undefined;
  }
  writeValue(root);
  return writer.toUint8Array();

  /* Run the toJSON11 > toJSON5 > toJSON ladder, the replacer, and the boxed-
   * primitive unwrap exactly once (they may have side effects), yielding either
   * the final value to serialize or SKIP. Splitting resolve from write lets the
   * object writer learn a member is skippable before it has written the key. */
  function resolveValue(key: string, holder: any): any {
    let value = holder[key];

    if (value != null && !(value instanceof RawValue) && !(value instanceof RawString)) {
      if (typeof value.toJSON11 === 'function') {
        value = value.toJSON11(key);
      } else if (typeof value.toJSON5 === 'function') {
        value = value.toJSON5(key);
      } else if (typeof value.toJSON === 'function') {
        value = value.toJSON(key);
      }
    }

    if (replacer) {
      value = replacer.call(holder, key, value);
    }

    if (value instanceof RawString || value instanceof RawValue) {
      return value;
    }

    if (value instanceof Number) {
      value = Number(value);
    } else if (value instanceof String) {
      value = String(value);
    } else if (value instanceof Boolean) {
      value = value.valueOf();
    }

    const type = typeof value;
    if (type === 'function' || type === 'symbol' || type === 'undefined') {
      return SKIP;
    }
    return value;
  }

  /* Write the bytes of an already-resolved (never SKIP) value into the shared
   * writer. */
  function writeValue(value: any): void {
    if (value instanceof RawString) {
      spliceEscaped(value.span(), value.quote);
      return;
    }

    if (value instanceof RawValue) {
      if (value.preEscaped) {
        spliceEscaped(value.bytes, value.quote as number);
      } else {
        escapeRaw(value.bytes);
      }
      return;
    }

    switch (value) {
      case null:
        writer.pushBytes(NULL_BYTES);
        return;
      case true:
        writer.pushBytes(TRUE_BYTES);
        return;
      case false:
        writer.pushBytes(FALSE_BYTES);
        return;
    }

    if (typeof value === 'string') {
      writer.pushBytes(enc(quoteString(value, quoteContext)));
      return;
    }

    if (typeof value === 'number') {
      writer.pushBytes(enc(String(value)));
      return;
    }

    if (typeof value === 'bigint') {
      writer.pushBytes(enc(value.toString() + (withBigInt === false ? '' : 'n')));
      return;
    }

    if (Array.isArray(value)) {
      writeArray(value);
    } else {
      writeObject(value);
    }
  }

  /* Write 0x0a followed by `depth` copies of the gap bytes — the byte form of
   * the string serializer's '\n' + indent, where indent is the gap repeated per
   * open container. */
  function writeIndent(depth: number): void {
    writer.pushByte(BYTE_NEWLINE);
    for (let i = 0; i < depth; i++) {
      writer.pushBytes(gapBytes);
    }
  }

  function spliceEscaped(inner: Uint8Array, quoteByte: number): void {
    writer.pushByte(quoteByte);
    writer.pushBytes(inner);
    writer.pushByte(quoteByte);
  }

  function escapeRaw(bytes: Uint8Array): void {
    /* Mirror quoteString's two-pass shape over the raw bytes: first bump the
     * shared quote weights for every literal '/" byte (exactly as quoteString
     * does per char) so this node both picks its own quote from — and
     * contributes to — the document-wide balance, then escape whichever quote
     * that balance selects. Byte-only: the weight keys are the static strings
     * "'"/'"', never value-derived bytes. */
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === QUOTE_SINGLE) quoteContext.quoteWeights["'"]++;
      else if (bytes[i] === QUOTE_DOUBLE) quoteContext.quoteWeights['"']++;
    }
    const quoteByte = chooseQuote(quoteContext) === '"' ? QUOTE_DOUBLE : QUOTE_SINGLE;

    writer.pushByte(quoteByte);
    escapeRawInto(writer, bytes, quoteByte);
    writer.pushByte(quoteByte);
  }

  function escapeRawInto(writer: ByteWriter, bytes: Uint8Array, quoteByte: number): void {
    const otherQuote = quoteByte === QUOTE_DOUBLE ? QUOTE_SINGLE : QUOTE_DOUBLE;
    const len = bytes.length;
    let i = 0;
    while (i < len) {
      const b = bytes[i];

      if (b >= 0x80) {
        let dec;
        try {
          dec = decodeUtf8(bytes, i);
        } catch (ex) {
          throw new TypeError(`JSON11: RawValue.raw contains malformed UTF-8 (${(ex as Error).message})`);
        }
        if (!dec) break;
        const escape = escapeTable.multiByte.get(dec.cp);
        if (escape) {
          writer.pushBytes(escape);
        } else {
          writer.pushBytes(bytes, i, i + dec.size);
        }
        i += dec.size;
        continue;
      }

      if (b === quoteByte) {
        writer.pushByte(0x5c);
        writer.pushByte(b);
        i++;
        continue;
      }
      if (b === otherQuote) {
        writer.pushByte(b);
        i++;
        continue;
      }
      if (b === 0x00) {
        const next = bytes[i + 1];
        writer.pushBytes(next >= 0x30 && next <= 0x39 ? escapeTable.nulDigit : escapeTable.byByte[0]!);
        i++;
        continue;
      }

      const e = escapeTable.byByte[b];
      if (e) {
        writer.pushBytes(e);
        i++;
        continue;
      }

      writer.pushByte(b);
      i++;
    }
  }

  /* Emit one resolved (never SKIP) object member as `key:value` (or `key: value`
   * when pretty). The string serializer serializes the value before the key
   * (serializeProperty then nameSerializer), so the key's quote choice depends
   * on the quote weights the value subtree contributes. To stay byte-identical
   * we must preserve that order: a bare-identifier key bumps no weights, so it
   * is written first and the value appended (single pass). A key that routes
   * through quoteString has its weight bumps rolled back, the value is
   * serialized first, then the key is re-serialized in the correct order and
   * spliced in front of the value bytes. */
  function writeMember(key: string, resolved: any): void {
    const savedSingle = quoteContext.quoteWeights["'"];
    const savedDouble = quoteContext.quoteWeights['"'];
    const keyBytes = nameSerializer(key);
    const keyQuoted = keyBytes.length > 0 && (keyBytes[0] === QUOTE_SINGLE || keyBytes[0] === QUOTE_DOUBLE);

    if (!keyQuoted) {
      writer.pushBytes(keyBytes);
      writer.pushByte(BYTE_COLON);
      if (pretty) {
        writer.pushByte(BYTE_SPACE);
      }
      writeValue(resolved);
      return;
    }

    quoteContext.quoteWeights["'"] = savedSingle;
    quoteContext.quoteWeights['"'] = savedDouble;

    const mark = writer.length;
    writeValue(resolved);

    const orderedKey = nameSerializer(key);
    const sepLength = pretty ? 2 : 1;
    const prefix = new Uint8Array(orderedKey.length + sepLength);
    prefix.set(orderedKey, 0);
    prefix[orderedKey.length] = BYTE_COLON;
    if (pretty) {
      prefix[orderedKey.length + 1] = BYTE_SPACE;
    }
    writer.insertBefore(mark, prefix);
  }

  function writeObject(value: any): void {
    if (stack.includes(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.length >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.push(value);

    /* The member indent is the gap repeated per open container (stack.length,
     * counting this object); the closing brace steps back one level. */
    const depth = stack.length;
    const keys = propertyList || Object.keys(value);

    writer.pushByte(BYTE_LBRACE);
    let emitted = 0;
    for (const key of keys) {
      const resolved = resolveValue(key, value);
      if (resolved === SKIP) {
        continue;
      }
      if (emitted > 0) {
        writer.pushByte(BYTE_COMMA);
      }
      if (pretty) {
        writeIndent(depth);
      }
      writeMember(key, resolved);
      emitted++;
    }

    if (emitted > 0 && pretty) {
      if (trailingComma) {
        writer.pushByte(BYTE_COMMA);
      }
      writeIndent(depth - 1);
    }
    writer.pushByte(BYTE_RBRACE);

    stack.pop();
  }

  function writeArray(value: any[]): void {
    if (stack.includes(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.length >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.push(value);

    const depth = stack.length;
    const len = value.length;

    writer.pushByte(BYTE_LBRACKET);
    for (let i = 0; i < len; i++) {
      if (i > 0) {
        writer.pushByte(BYTE_COMMA);
      }
      if (pretty) {
        writeIndent(depth);
      }
      const resolved = resolveValue(String(i), value);
      if (resolved === SKIP) {
        writer.pushBytes(NULL_BYTES);
      } else {
        writeValue(resolved);
      }
    }

    if (len > 0 && pretty) {
      if (trailingComma) {
        writer.pushByte(BYTE_COMMA);
      }
      writeIndent(depth - 1);
    }
    writer.pushByte(BYTE_RBRACKET);

    stack.pop();
  }
}

type EscapeTable = {
  byByte: (Uint8Array | undefined)[];
  nulDigit: Uint8Array;
  multiByte: Map<number, Uint8Array>;
};

/* Build the escape table from the same shared escape mappings the string
 * serializer uses, so RawValue.raw escaping is consistent with the rest of
 * JSON11's output: a byte-indexed array for the ASCII (< 0x80) escapes and a
 * code-point-keyed map for the non-ASCII ones. Deriving the multibyte set from
 * the table (rather than hardcoding U+2028/U+2029) keeps the raw path in
 * lockstep with the string path by construction — a new non-ASCII entry in the
 * shared table is picked up here automatically. */
function buildEscapeTable(ctx: QuoteContext): EscapeTable {
  const byByte: (Uint8Array | undefined)[] = new Array(0x80);
  for (let b = 0; b < 0x20; b++) {
    byByte[b] = enc(controlEscape(b, ctx.withLegacyEscapes));
  }
  const multiByte = new Map<number, Uint8Array>();
  for (const key of Object.keys(ctx.quoteReplacements)) {
    const cp = key.codePointAt(0)!;
    if (cp < 0x80) {
      if (cp !== QUOTE_DOUBLE && cp !== QUOTE_SINGLE) {
        byByte[cp] = enc(ctx.quoteReplacements[key]);
      }
    } else {
      multiByte.set(cp, enc(ctx.quoteReplacements[key]));
    }
  }
  return {
    byByte,
    nulDigit: enc(ctx.nulFollowedByDigit),
    multiByte,
  };
}
