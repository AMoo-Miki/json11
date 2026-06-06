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

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function joinBytes(parts: Uint8Array[], sep: Uint8Array): Uint8Array {
  if (parts.length === 0) return new Uint8Array(0);
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) pieces.push(sep);
    pieces.push(parts[i]);
  }
  return concat(pieces);
}

export function serializeToBytes(value: any, config: SerializeConfig): Uint8Array | undefined {
  const { gap, trailingComma, quoteContext, quoteNames, replacer, propertyList, withBigInt, maxDepth } = config;
  const stack: any[] = [];
  let indent = '';

  const escapeTable = buildEscapeTable(quoteContext);

  const nameSerializer = (key: string): Uint8Array =>
    enc(quoteNames ? quoteString(key, quoteContext) : serializeKey(key, quoteContext));

  return serializeProperty('', { '': value });

  function serializeProperty(key: string, holder: any): Uint8Array | undefined {
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

    if (value instanceof RawString) {
      return spliceEscaped(value.span(), value.quote);
    }

    if (value instanceof RawValue) {
      if (value.preEscaped) {
        return spliceEscaped(value.bytes, value.quote as number);
      }
      return escapeRaw(value.bytes);
    }

    if (value instanceof Number) {
      value = Number(value);
    } else if (value instanceof String) {
      value = String(value);
    } else if (value instanceof Boolean) {
      value = value.valueOf();
    }

    switch (value) {
      case null:
        return enc('null');
      case true:
        return enc('true');
      case false:
        return enc('false');
    }

    if (typeof value === 'string') {
      return enc(quoteString(value, quoteContext));
    }

    if (typeof value === 'number') {
      return enc(String(value));
    }

    if (typeof value === 'bigint') {
      return enc(value.toString() + (withBigInt === false ? '' : 'n'));
    }

    if (typeof value === 'object') {
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value);
    }

    return undefined;
  }

  function spliceEscaped(inner: Uint8Array, quoteByte: number): Uint8Array {
    const out = new Uint8Array(inner.length + 2);
    out[0] = quoteByte;
    out.set(inner, 1);
    out[out.length - 1] = quoteByte;
    return out;
  }

  function escapeRaw(bytes: Uint8Array): Uint8Array {
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

    const writer = new ByteWriter(bytes.length + 2);
    writer.pushByte(quoteByte);
    escapeRawInto(writer, bytes, quoteByte);
    writer.pushByte(quoteByte);
    return writer.toUint8Array();
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

  function serializeObject(value: any): Uint8Array {
    if (stack.includes(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.length >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.push(value);

    const stepback = indent;
    indent = indent + gap;

    const keys = propertyList || Object.keys(value);
    const partial: Uint8Array[] = [];
    for (const key of keys) {
      const propertyBytes = serializeProperty(key, value);
      if (propertyBytes !== undefined) {
        const head = enc(gap !== '' ? ':' + ' ' : ':');
        partial.push(concat([nameSerializer(key), head, propertyBytes]));
      }
    }

    let final: Uint8Array;
    if (partial.length === 0) {
      final = enc('{}');
    } else if (gap === '') {
      final = concat([enc('{'), joinBytes(partial, enc(',')), enc('}')]);
    } else {
      final = concat([
        enc('{\n' + indent),
        joinBytes(partial, enc(',\n' + indent)),
        enc(trailingComma + '\n' + stepback + '}'),
      ]);
    }

    stack.pop();
    indent = stepback;
    return final;
  }

  function serializeArray(value: any[]): Uint8Array {
    if (stack.includes(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.length >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.push(value);

    const stepback = indent;
    indent = indent + gap;

    const partial: Uint8Array[] = [];
    for (let i = 0; i < value.length; i++) {
      const propertyBytes = serializeProperty(String(i), value);
      partial.push(propertyBytes !== undefined ? propertyBytes : enc('null'));
    }

    let final: Uint8Array;
    if (partial.length === 0) {
      final = enc('[]');
    } else if (gap === '') {
      final = concat([enc('['), joinBytes(partial, enc(',')), enc(']')]);
    } else {
      final = concat([
        enc('[\n' + indent),
        joinBytes(partial, enc(',\n' + indent)),
        enc(trailingComma + '\n' + stepback + ']'),
      ]);
    }

    stack.pop();
    indent = stepback;
    return final;
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
