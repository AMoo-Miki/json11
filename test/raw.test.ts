import { expect, describe, it } from 'vitest';
import { parse, stringify, RawString, RawValue, unsafeEncodeAsJSON } from '../src';
import { QUOTE_SINGLE } from '../src/raw';
import { dec, enc, makeRng, randString } from './_helpers';

describe('RawString', () => {
  it('span aliases the source, copy does not', () => {
    const buf = enc('"hello"');
    const rs = new RawString(buf, 1, 6, 0x22);
    expect(rs.span().buffer).toBe(buf.buffer);
    expect(rs.copy().buffer).not.toBe(buf.buffer);
    expect(dec(rs.span())).toBe('hello');
    expect(dec(rs.copy())).toBe('hello');
  });

  it('decode() and toString() agree across escape forms', () => {
    const cases: [string, string][] = [
      ['a\\u0041b', 'aAb'],
      ['\\b\\f\\n\\r\\t\\v\\0', '\b\f\n\r\t\v\0'],
      ['\\x41\\x7f', 'A\x7f'],
      ['\\uD83D\\uDE00', '\u{1F600}'],
      ['caf\u00e9', 'caf\u00e9'],
      ['line\\\ncont', 'linecont'],
      ['\\a\\b\\q', 'a\bq'],
      ['plain text', 'plain text'],
    ];
    for (const [inner, expected] of cases) {
      const buf = enc(`"${inner}"`);
      const rs = new RawString(buf, 1, buf.length - 1, 0x22);
      expect(rs.unsafeDecodeToString()).toBe(expected);
      expect(dec(rs.decode())).toBe(expected);
    }
  });

  it('static decodeBytes decodes an explicit span', () => {
    const buf = enc('   a\\u0041b   ');
    // inner range covers a\u0041b (indices 3..10 inclusive -> end 11)
    expect(dec(RawString.decodeBytes(buf, 3, 11))).toBe('aAb');
  });

  it('decodeBytes throws on a span the default quote does not fully consume', () => {
    // A single-quoted value's span legitimately holds an unescaped `"`; decoding
    // it with the default `"` terminator used to silently truncate to `a`.
    expect(() => RawString.decodeBytes(enc('a"b'), 0, 3)).toThrow(TypeError);
  });

  it('decodeBytes decodes a `"`-bearing span when given the matching quote', () => {
    expect(dec(RawString.decodeBytes(enc('a"b'), 0, 3, QUOTE_SINGLE))).toBe('a"b');
  });

  it('decodeBytes rejects out-of-range start/end with a TypeError', () => {
    const buf = enc('a\\u0041b');
    expect(() => RawString.decodeBytes(buf, 0, buf.length + 1)).toThrow(TypeError);
    expect(() => RawString.decodeBytes(buf, 3, 1)).toThrow(TypeError);
  });

  it('instance decode() of a single-quoted value is unaffected (forwards its quote)', () => {
    const doc: any = parse(enc(`{"k":'a"b'}`), null, { raw: 'values' });
    expect(doc.k).toBeInstanceOf(RawString);
    expect(doc.k.quote).toBe(QUOTE_SINGLE);
    expect(dec(doc.k.decode())).toBe('a"b');
  });

  it('decode never constructs a String (returns Uint8Array)', () => {
    const doc: any = parse(enc('{"s":"secret"}'), null, { raw: 'values' });
    expect(doc.s.decode()).toBeInstanceOf(Uint8Array);
    expect(doc.s.span()).toBeInstanceOf(Uint8Array);
  });
});

describe('RawValue', () => {
  it('escaped carries the quote and pre-escaped bytes', () => {
    const rv = RawValue.escaped(enc('a\\nb'), 0x22);
    expect(rv.preEscaped).toBe(true);
    expect(rv.quote).toBe(0x22);
  });
  it('raw carries unescaped bytes', () => {
    const rv = RawValue.raw(enc('a\nb'));
    expect(rv.preEscaped).toBe(false);
  });

  it('escaped throws when inner carries an unescaped closing quote (structure injection)', () => {
    expect(() => RawValue.escaped(enc('a","injected":"b'), 0x22)).toThrow(TypeError);
  });

  it('escaped throws on a quote/span mismatch (a `"`-bearing span passed as 0x22)', () => {
    // The bytes are a valid single-quoted span (unescaped `"` is legal there);
    // re-framing them with `"` would break out of the string.
    expect(() => RawValue.escaped(enc('a"b'), 0x22)).toThrow(TypeError);
    // …but the same span is splice-able with its own quote.
    expect(RawValue.escaped(enc('a"b'), QUOTE_SINGLE).preEscaped).toBe(true);
  });

  it('escaped still accepts a legitimate same-quote span lifted from a document', () => {
    const docBytes = stringify({ subkey: 'he said "hi"\tand left' }, { raw: true })!;
    const parsed: any = parse(docBytes, null, { raw: 'values' });
    const span = parsed.subkey.span();
    const quote = parsed.subkey.quote;
    // Validation must not reject a real span; the splice round-trips byte-identically.
    const out = stringify({ moved: RawValue.escaped(span, quote) }, { raw: true })!;
    const re: any = parse(out, null, { raw: 'values' });
    expect(dec(re.moved.decode())).toBe('he said "hi"\tand left');
    expect(dec(out).includes(dec(span))).toBe(true);
  });

  it('raw is untouched by the escaped validation', () => {
    const rv = RawValue.raw(enc('a","injected":"b'));
    expect(rv.preEscaped).toBe(false);
  });
});

describe('Bar #4 — escape consistency, byte-identical span splice', () => {
  it('a span lifted from one JSON11 doc, spliced into another, round-trips byte-identically', () => {
    const rng = makeRng(0x5AFE);
    for (let i = 0; i < 1500; i++) {
      const secret = randString(rng, 30);
      // Produce a JSON11 document (bytes) the canonical way.
      const docBytes = stringify({ subkey: secret, n: i }, { raw: true })!;
      // Lift the value as a borrowed span (no String for the secret).
      const parsed: any = parse(docBytes, null, { raw: 'values' });
      const span = parsed.subkey.span();
      const quote = parsed.subkey.quote;
      // Splice that exact span into a fresh JSON11 document.
      const out = stringify({ moved: RawValue.escaped(span, quote) }, { raw: true })!;
      // Re-parse and confirm the moved value decodes to the original secret.
      const re: any = parse(out, null, { raw: 'values' });
      expect(dec(re.moved.decode())).toBe(secret);
      // The escaped inner bytes are present verbatim (no re-escaping happened).
      expect(dec(out).includes(dec(span))).toBe(true);
    }
  });

  it('decode(escape(bytes)) === bytes for raw injection (round trip)', () => {
    const rng = makeRng(0xD00D);
    for (let i = 0; i < 1500; i++) {
      const original = enc(randString(rng, 30));
      const out = stringify({ v: RawValue.raw(original) }, { raw: true })!;
      const re: any = parse(out, null, { raw: 'values' });
      expect(Array.from(re.v.decode())).toEqual(Array.from(original));
    }
  });

  it('the secret value is never produced as a JS String end-to-end', () => {
    // Guard: replacing String.prototype methods that would coerce the secret
    // would surface here, but more importantly the value types are byte arrays.
    const secretBuf = enc('{"subkey":"do-not-stringify-me","meta":"ok"}');
    const doc: any = parse(secretBuf, null, { raw: 'values' });
    expect(doc.subkey).toBeInstanceOf(RawString);
    // Move it without ever calling toString on the secret:
    const out = stringify({ moved: RawValue.escaped(doc.subkey.span(), doc.subkey.quote) }, { raw: true })!;
    expect(out).toBeInstanceOf(Uint8Array);
    // The non-secret metadata may be decoded to a String safely.
    expect(doc.meta.unsafeDecodeToString()).toBe('ok');
  });
});

describe('no-String surface — implicit coercion and JSON fail closed', () => {
  it('secret-bearing fields are non-enumerable (no property-walk leak)', () => {
    const rs = new RawString(enc('"S3cr3t-VALUE"'), 1, 13, 0x22);
    expect(Object.keys(rs)).toEqual([]);
    expect(Object.keys(rs)).not.toContain('source');
    // still publicly readable
    expect(rs.source).toBeInstanceOf(Uint8Array);
    expect(rs.start).toBe(1);
    expect(rs.end).toBe(13);
    expect(rs.quote).toBe(0x22);
  });

  it('toString() returns a byte-free placeholder built from the length only', () => {
    const rs = new RawString(enc('"S3cr3t-VALUE"'), 1, 13, 0x22);
    expect(rs.toString()).toBe('[RawString length=12]');
    expect(rs.toString()).not.toContain('S3cr3t');
  });

  it('implicit coercion throws instead of materializing the value', () => {
    const rs = new RawString(enc('"S3cr3t-VALUE"'), 1, 13, 0x22);
    expect(() => `${rs}`).toThrow(TypeError);
    expect(() => String(rs)).toThrow(TypeError);
    expect(() => '' + (rs as any)).toThrow(TypeError);
    expect(() => [rs].join(',')).toThrow(TypeError);
    expect(() => (rs as any).valueOf()).toThrow(TypeError);
  });

  it('JSON.stringify throws for any raw-parsed tree (secret or not)', () => {
    const doc: any = parse(enc('{"subkey":"secret","meta":"ok"}'), null, { raw: 'values' });
    expect(() => JSON.stringify(doc)).toThrow(TypeError);
    expect(() => JSON.stringify(doc.subkey)).toThrow(TypeError);
  });

  it('unsafeDecodeToString() is the explicit single-value hatch', () => {
    const doc: any = parse(enc('{"k":"S3cr3t\\u0041"}'), null, { raw: 'values' });
    expect(doc.k.unsafeDecodeToString()).toBe('S3cr3tA');
  });
});

describe('unsafeEncodeAsJSON — the deliberate whole-tree JSON opt-in', () => {
  it('materializes RawStrings and round-trips through JSON.stringify', () => {
    const doc: any = parse(enc('{"a":"x\\u0041","b":["y",1,true,null],"n":2}'), null, { raw: 'values' });
    const plain = unsafeEncodeAsJSON(doc);
    expect(plain).toEqual({ a: 'xA', b: ['y', 1, true, null], n: 2 });
    expect(JSON.stringify(plain)).toBe('{"a":"xA","b":["y",1,true,null],"n":2}');
  });

  it('does not mutate the source tree (RawStrings stay byte-only)', () => {
    const doc: any = parse(enc('{"a":"x"}'), null, { raw: 'values' });
    unsafeEncodeAsJSON(doc);
    expect(doc.a).toBeInstanceOf(RawString);
  });

  it('rebuilds objects prototype-safely', () => {
    const doc: any = parse(enc('{"__proto__":"polluted","ok":"v"}'), null, { raw: 'values' });
    const plain: any = unsafeEncodeAsJSON(doc);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(plain, '__proto__')).toBe(true);
  });

  it('decodes a RawValue defensively via the StringSink path', () => {
    const plain = unsafeEncodeAsJSON({ v: RawValue.escaped(enc('a\\nb'), 0x22) }) as any;
    expect(plain.v).toBe('a\nb');
  });
});
