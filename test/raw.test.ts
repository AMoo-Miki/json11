import { expect, describe, it, vi } from 'vitest';
import { parse, stringify, RawString, RawValue, unsafeEncodeAsJSON } from '../src';
import { QUOTE_SINGLE } from '../src/raw';
import { dec, enc, makeRng, randString } from './_helpers';

/* The runtime objects these suites monkeypatch (String, globalThis,
 * TextDecoder.prototype, Buffer.prototype) plus the function members they swap. */
type MethodHolder = Record<string, unknown>;
type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/* Parse byte input in raw-values mode; the curated inputs in this file all yield
 * an object whose string values are borrowed RawString spans. */
function parseRaw(input: Uint8Array): Record<string, RawString> {
  return parse(input, null, { raw: 'values' }) as Record<string, RawString>;
}

/* Wrap every byte→String entry point and record each call, so a region asserted
 * to be byte-only can prove it made zero of them (mirrors heapHygiene B1). The
 * wrapper bodies call only push/apply, so they cannot recurse through String(…). */
function installByteToStringSpies() {
  const calls: string[] = [];
  const saved: Array<[MethodHolder, string, unknown]> = [];
  const wrap = (obj: object | null | undefined, key: string) => {
    if (!obj) return;
    const target = obj as MethodHolder;
    if (typeof target[key] !== 'function') return;
    const orig = target[key] as AnyFunction;
    saved.push([target, key, orig]);
    target[key] = function (this: unknown, ...a: unknown[]) {
      calls.push(key);
      return orig.apply(this, a);
    };
  };
  wrap(String, 'fromCharCode');
  wrap(String, 'fromCodePoint');
  wrap(globalThis, 'String');
  wrap(TextDecoder.prototype, 'decode');
  for (const m of ['toString', 'utf8Slice', 'latin1Slice', 'asciiSlice', 'ucs2Slice', 'hexSlice']) {
    wrap(Buffer.prototype, m);
  }
  return {
    calls,
    restore() {
      for (const [obj, key, orig] of saved) obj[key] = orig;
    },
  };
}

/* Records the numeric args handed to fromCharCode/fromCodePoint so a region that
 * legitimately stringifies a *key* can still prove the *value*'s code points were
 * never stringified, even one char at a time (mirrors heapHygiene B2). Leaves the
 * String object and its other statics intact. */
function installFromCodeArgSpies() {
  const args: number[] = [];
  const saved: Array<[MethodHolder, string, unknown]> = [];
  const wrap = (obj: object, key: string) => {
    const target = obj as MethodHolder;
    const orig = target[key] as AnyFunction;
    saved.push([target, key, orig]);
    target[key] = function (this: unknown, ...a: unknown[]) {
      for (const x of a) if (typeof x === 'number') args.push(x);
      return orig.apply(this, a);
    };
  };
  wrap(String, 'fromCharCode');
  wrap(String, 'fromCodePoint');
  return {
    args,
    restore() {
      for (const [obj, key, orig] of saved) obj[key] = orig;
    },
  };
}

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
      // 2-byte UTF-8 emitter: a \u escape producing U+0080..U+07FF is the only
      // path that reaches ByteWriter.pushCodePoint's `cp < 0x800` arm; pin it
      // (and the 3-byte boundary at U+0800) against toString().
      ['\\u00e9', '\u00e9'],
      ['\\u0800', '\u0800'],
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
    const doc = parseRaw(enc(`{"k":'a"b'}`));
    expect(doc.k).toBeInstanceOf(RawString);
    expect(doc.k.quote).toBe(QUOTE_SINGLE);
    expect(dec(doc.k.decode())).toBe('a"b');
  });

  it('decode never constructs a String (returns Uint8Array)', () => {
    const doc = parseRaw(enc('{"s":"secret"}'));
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
    const parsed = parseRaw(docBytes);
    const span = parsed.subkey.span();
    const quote = parsed.subkey.quote;
    // Validation must not reject a real span; the splice round-trips byte-identically.
    const out = stringify({ moved: RawValue.escaped(span, quote) }, { raw: true })!;
    const re = parseRaw(out);
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
      const parsed = parseRaw(docBytes);
      const span = parsed.subkey.span();
      const quote = parsed.subkey.quote;
      // Splice that exact span into a fresh JSON11 document.
      const out = stringify({ moved: RawValue.escaped(span, quote) }, { raw: true })!;
      // Re-parse and confirm the moved value decodes to the original secret.
      const re = parseRaw(out);
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
      const re = parseRaw(out);
      expect(Array.from(re.v.decode())).toEqual(Array.from(original));
    }
  });

  it('the secret value is never produced as a JS String (byte-only accessors; value code points never stringified)', () => {
    // A distinctive PUA/astral value: even a char-by-char stringify of it would
    // surface U+E007 (BMP) or the surrogate halves of U+10FFFD as a fromCode*
    // argument. Parsing happens OUTSIDE the spies because it legitimately
    // stringifies the keys ("subkey"/"meta").
    const secretBuf = enc('{"subkey":"\uE007do-not-stringify-me\u{10FFFD}","meta":"ok"}');
    const doc = parseRaw(secretBuf);
    expect(doc.subkey).toBeInstanceOf(RawString);

    // 1) The value's own accessors funnel through ZERO byte→String primitives.
    const counting = installByteToStringSpies();
    try {
      doc.subkey.span();
      doc.subkey.decode();
      doc.subkey.copy();
    } finally {
      counting.restore();
    }
    expect(counting.calls).toEqual([]);

    // 2) Across the full move (span → reinject), the value's code points never
    //    reach fromCharCode/fromCodePoint — even though serializing the *key*
    //    "moved" legitimately does. That is what "never a String end-to-end" means.
    const argRec = installFromCodeArgSpies();
    let out: Uint8Array;
    try {
      out = stringify({ moved: RawValue.escaped(doc.subkey.span(), doc.subkey.quote) }, { raw: true })!;
    } finally {
      argRec.restore();
    }
    expect(out).toBeInstanceOf(Uint8Array);
    expect(argRec.args).not.toContain(0xe007); // BMP value char
    expect(argRec.args).not.toContain(0x10fffd); // astral value char (fromCodePoint)
    expect(argRec.args).not.toContain(0xdbff); // its high surrogate (fromCharCode)
    expect(argRec.args).not.toContain(0xdffd); // its low surrogate (fromCharCode)

    // The non-secret metadata may be decoded to a String safely (outside the spies).
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
    expect(() => '' + (rs as unknown as string)).toThrow(TypeError);
    expect(() => [rs].join(',')).toThrow(TypeError);
    expect(() => (rs as unknown as string).valueOf()).toThrow(TypeError);
  });

  it('JSON.stringify throws for any raw-parsed tree (secret or not)', () => {
    const doc = parseRaw(enc('{"subkey":"secret","meta":"ok"}'));
    expect(() => JSON.stringify(doc)).toThrow(TypeError);
    expect(() => JSON.stringify(doc.subkey)).toThrow(TypeError);
  });

  it('unsafeDecodeToString() is the explicit single-value hatch', () => {
    const doc = parseRaw(enc('{"k":"S3cr3t\\u0041"}'));
    expect(doc.k.unsafeDecodeToString()).toBe('S3cr3tA');
  });
});

describe('unsafeEncodeAsJSON — the deliberate whole-tree JSON opt-in', () => {
  it('materializes RawStrings and round-trips through JSON.stringify', () => {
    const doc = parse(enc('{"a":"x\\u0041","b":["y",1,true,null],"n":2}'), null, { raw: 'values' });
    const plain = unsafeEncodeAsJSON(doc);
    expect(plain).toEqual({ a: 'xA', b: ['y', 1, true, null], n: 2 });
    expect(JSON.stringify(plain)).toBe('{"a":"xA","b":["y",1,true,null],"n":2}');
  });

  it('does not mutate the source tree (RawStrings stay byte-only)', () => {
    const doc = parseRaw(enc('{"a":"x"}'));
    unsafeEncodeAsJSON(doc);
    expect(doc.a).toBeInstanceOf(RawString);
  });

  it('rebuilds objects prototype-safely', () => {
    const doc = parse(enc('{"__proto__":"polluted","ok":"v"}'), null, { raw: 'values' });
    const plain = unsafeEncodeAsJSON(doc);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(plain, '__proto__')).toBe(true);
  });

  it('decodes a RawValue defensively via the StringSink path', () => {
    const plain = unsafeEncodeAsJSON({ v: RawValue.escaped(enc('a\\nb'), 0x22) }) as { v: string };
    expect(plain.v).toBe('a\nb');
  });
});

describe('byte parser separatorWarn — fires on the value path and leaks no value bytes', () => {
  /* The byte parser's separatorWarn (the only console output reachable from the
   * raw value path) must fire on a raw U+2028/U+2029 inside a value AND carry no
   * value-derived bytes — a direct corollary of the "no value bytes in messages"
   * invariant. Every other byte suite silences this globally; this file installs
   * no blanket silencer, so the spy below is the sole controller of console.warn.
   * The test never decodes the parsed value, so it materializes no String of it. */
  it('warns once with the fixed advisory and none of the surrounding value bytes', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => null);
    try {
      // Distinctive ascii markers bracket a single raw U+2028 in the value.
      const doc = parseRaw(enc('{"k":"LEFTMARK\u2028RIGHTMARK"}'));
      expect(doc.k).toBeInstanceOf(RawString);

      expect(spy).toHaveBeenCalledTimes(1);
      const msg = String(spy.mock.calls[0][0]);
      expect(msg).toContain('not valid ECMAScript');
      // The fixed advisory must not embed the value's surrounding content.
      expect(msg).not.toContain('LEFTMARK');
      expect(msg).not.toContain('RIGHTMARK');
    } finally {
      spy.mockRestore();
    }
  });
});
