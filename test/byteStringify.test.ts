import { expect, describe, it } from 'vitest';
import { parse, stringify, RawString, RawValue } from '../src';
import { dec, enc, makeRng, randString, randValue } from './_helpers';

const bytes = (v: any, ...args: any[]): Uint8Array => (stringify as any)(v, ...args) as Uint8Array;

describe('stringify(value, { raw: true }) — byte output equals utf8(string output)', () => {
  it('matches for primitives and structures', () => {
    const vals = [
      null, true, false, 0, -0, 1.5, -42, 1e21, 123n,
      'plain', "a'b\"c\n\t\\", '', '\u{1F600}\u00e9\u4e2d',
      [1, 'two', 3n, null, [false]], { a: 1, 'b c': 'x', n: null },
      { nested: { deep: { x: ['a\\b', "q'q", 'd"d'] } } },
      { '\0\x01\x1f\u2028\u2029': 'controls' },
    ];
    for (const v of vals) {
      expect(dec(bytes(v, { raw: true }))).toBe(stringify(v));
    }
  });

  it('matches across all option permutations on a generated corpus', () => {
    const rng = makeRng(0xBEEF);
    const optionSets: any[] = [
      {},
      { quote: '"' },
      { quote: "'" },
      { quoteNames: true },
      { space: 2 },
      { space: '\t' },
      { space: 4, trailingComma: true },
      { withBigInt: false },
      { withLegacyEscapes: true },
      { quote: '"', space: 2, quoteNames: true, trailingComma: true },
    ];
    for (let i = 0; i < 2000; i++) {
      const v = randValue(rng);
      const opts = optionSets[i % optionSets.length];
      const str = stringify(v, opts);
      const raw = bytes(v, { ...opts, raw: true });
      expect(dec(raw)).toBe(str ?? '');
    }
  });

  it('matches with positional (replacer, space) and options forms', () => {
    const v = { a: 1, b: 2, c: 3 };
    const replacer = (k: string, val: any) => (k === 'b' ? undefined : val);
    expect(dec(bytes(v, replacer, 2, { raw: true }))).toBe(stringify(v, replacer, 2));
    expect(dec(bytes(v, ['a', 'c'], 0, { raw: true }))).toBe(stringify(v, ['a', 'c']));
  });

  it('returns undefined for non-serializable roots (like the string serializer)', () => {
    expect(stringify(undefined, { raw: true })).toBeUndefined();
    expect(stringify(() => {}, { raw: true })).toBeUndefined();
  });
});

describe('stringify(value, { raw: true }) — RawValue / RawString injection', () => {
  it('splices a pre-escaped span verbatim, byte-identical (bar #4)', () => {
    const src = enc('{"subkey":"S\\u0041 \\"q\\" \\\\ \\n end \\uD83D\\uDE00","meta":"ok"}');
    const doc: any = parse(src, null, { raw: 'values' });
    const out = bytes({ moved: RawValue.escaped(doc.subkey.span(), doc.subkey.quote) }, { raw: true });
    // The inner escaped bytes appear verbatim in the output
    expect(dec(out).includes(dec(doc.subkey.span()))).toBe(true);
    // And it re-parses to the same decoded value
    const re: any = parse(out, null, { raw: 'values' });
    expect(dec(re.moved.decode())).toBe(dec(doc.subkey.decode()));
  });

  it('injects a RawString directly (it is a raw node)', () => {
    const doc: any = parse(enc('{"x":"hi \\u0041"}'), null, { raw: 'values' });
    const out = bytes({ y: doc.x }, { raw: true });
    const re: any = parse(out, null, { raw: 'values' });
    expect(dec(re.y.decode())).toBe('hi A');
  });

  it('escapes raw bytes with JSON11 own escaper and round-trips', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const s = randString(rng, 30);
      const out = bytes({ v: RawValue.raw(enc(s)) }, { raw: true });
      const re: any = parse(out, null, { raw: 'values' });
      expect(dec(re.v.decode())).toBe(s);
      // and the decoded byte value equals the original bytes
      expect(Array.from(re.v.decode())).toEqual(Array.from(enc(s)));
    }
  });

  it('RawValue.raw output equals the same content serialized as a normal string', () => {
    /* The one-engine lock: a raw node must serialize byte-for-byte the way the
     * same bytes written as a normal string value would (quote choice + escape
     * set). The corpus is valid Unicode-scalar content (randString never emits a
     * lone surrogate), so enc(s)/s round-trip cleanly and there is no NUL/control
     * case where raw-vs-normal legitimately differ. U+2028/U+2029 are in
     * SCALAR_CODE_POINTS, so the table-derived multibyte escape path is exercised. */
    const rng = makeRng(0x0B11E);
    const optionSets: any[] = [
      {}, { quote: '"' }, { quote: "'" }, { withLegacyEscapes: true }, { quoteNames: true },
    ];
    for (let i = 0; i < 2000; i++) {
      const s = randString(rng, 30);
      const opts = optionSets[i % optionSets.length];
      const rawOut = dec(bytes({ x: RawValue.raw(enc(s)) }, { ...opts, raw: true }));
      const normOut = dec(bytes({ x: s }, { ...opts, raw: true }));
      expect(rawOut).toBe(normOut);
    }
  });

  it("picks the quote by content like a normal string (O'Brien -> double quotes)", () => {
    const out = dec(bytes({ x: RawValue.raw(enc("O'Brien")) }, { raw: true }));
    expect(out).toBe(dec(bytes({ x: "O'Brien" }, { raw: true })));
    expect(out).toBe('{x:"O\'Brien"}');
  });

  it("a raw node's quotes shift a later sibling string's quote choice (shared balance)", () => {
    /* The raw node carries three " and no ', bumping the shared double-quote
     * weight; the sibling "it's" (which alone would pick " as its delimiter)
     * therefore flips to ' and escapes its apostrophe — exactly as a normal
     * string with the raw node's content would have made it. */
    const withRaw = dec(bytes({ a: RawValue.raw(enc('"""')), b: "it's" }, { raw: true }));
    const withStr = dec(bytes({ a: '"""', b: "it's" }, { raw: true }));
    expect(withRaw).toBe(withStr);
    expect(withRaw).toBe('{a:\'"""\',b:\'it\\\'s\'}');
    // Without the preceding raw/string node, "it's" alone picks double quotes.
    expect(dec(bytes({ b: "it's" }, { raw: true }))).toBe('{b:"it\'s"}');
  });

  it('raw injection works nested in arrays and objects with spacing', () => {
    const secret = RawValue.raw(enc("top'secret\nwith \"both\" quotes"));
    const out = bytes({ a: [1, { b: secret }], c: secret }, { raw: true, space: 2 });
    const re: any = parse(out, null, { raw: 'values' });
    expect(dec(re.a[1].b.decode())).toBe("top'secret\nwith \"both\" quotes");
    expect(dec(re.c.decode())).toBe("top'secret\nwith \"both\" quotes");
  });

  it('RawValue.escaped requires a valid quote byte', () => {
    expect(() => RawValue.escaped(enc('x'), 0x40 as any)).toThrow(TypeError);
  });

  it('RawValue.raw rejects malformed UTF-8', () => {
    const out = () => bytes({ v: RawValue.raw(new Uint8Array([0xff, 0xfe])) }, { raw: true });
    expect(out).toThrow(TypeError);
  });

  it('RawValue/RawString in string mode throw a typed error', () => {
    expect(() => stringify({ x: RawValue.raw(enc('hi')) })).toThrow(TypeError);
    const rs = new RawString(enc('"x"'), 1, 2, 0x22);
    expect(() => stringify({ x: rs })).toThrow(TypeError);
  });
});

describe('serializer nesting-depth cap (string ≡ bytes)', () => {
  /* `n` nested arrays around a leaf 0; entering the innermost array happens with
   * `n - 1` open ancestors, so the cap rejects when n > maxDepth. */
  const nestedValue = (n: number): any => {
    let v: any = 0;
    for (let i = 0; i < n; i++) v = [v];
    return v;
  };

  it('rejects past the cap on both serializers with a typed TypeError', () => {
    const v = nestedValue(60);
    expect(() => stringify(v, { maxDepth: 50 })).toThrow(TypeError);
    expect(() => stringify(v, { raw: true, maxDepth: 50 })).toThrow(TypeError);
  });

  it('accepts exactly at the cap and the byte output decodes to the string output', () => {
    const v = nestedValue(50);
    const str = stringify(v, { maxDepth: 50 });
    const raw = bytes(v, { raw: true, maxDepth: 50 });
    expect(dec(raw)).toBe(str);
  });
});
