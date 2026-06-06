import { expect, describe, it } from 'vitest';
import { parse, stringify, RawString, RawValue } from '../src';
import { dec, enc, makeRng, randString, randValue } from './_helpers';

/* Differential harness that drives the byte serializer through every positional
 * form the public overloads accept: the two-arg `(value, options)` shape and the
 * four-arg `(value, replacer|allowList, space, options)` shape. Each form is
 * dispatched to the typed `raw: true` overload (no `as any`), so a regression in
 * the `raw: true -> Uint8Array` overload discrimination fails to typecheck here. */
const bytes = (v: any, ...args: any[]): Uint8Array =>
  (args.length === 1
    ? stringify(v, args[0] as { raw: true })
    : stringify(v, args[0], args[1], args[2] as { raw: true }))!;

describe('stringify(value, { raw: true }) — byte output equals utf8(string output)', () => {
  it('matches for primitives and structures', () => {
    const vals = [
      null, true, false, 0, -0, 1.5, -42, 1e21, 123n,
      'plain', "a'b\"c\n\t\\", '', '\u{1F600}\u00e9\u4e2d',
      [1, 'two', 3n, null, [false]], { a: 1, 'b c': 'x', n: null },
      { nested: { deep: { x: ['a\\b', "q'q", 'd"d'] } } },
      { '\0\x01\x1f\u2028\u2029': 'controls' },
      // Boxed primitives: the byte serializer re-implements the unwrap arms, so
      // making them differential pins those arms against the string serializer.
      new Number(-1.2), new String('abc'), new Boolean(true), new Boolean(false),
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

  it('mirrors the capped space (>10) as a byte differential', () => {
    const v = { a: 1 };
    expect(dec(bytes(v, { space: 20, raw: true }))).toBe(stringify(v, { space: 20 }));
    expect(dec(bytes(v, { space: '----------XXXX', raw: true }))).toBe(stringify(v, { space: '----------XXXX' }));
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

describe('stringify(value, { raw: true }) — toJSON ladder and Date (byte ≡ string)', () => {
  /* The byte serializer re-implements the toJSON11 > toJSON5 > toJSON precedence
   * ladder; randValue cannot construct a toJSON-bearing object, so without these
   * the byte ladder is never exercised. These mirror the string-serializer
   * fixtures (test/stringify.test.ts) and bolt the two serializers together via
   * the existing dec(bytes(v,{raw:true})) === stringify(v) equality. */
  class ToJSON {
    toJSON() { return { a: 1, b: 2 }; }
  }
  class ToJSONKey {
    toJSON(key: any) { return key === 'a' ? 1 : 2; }
  }
  class ToJSON5 {
    toJSON5() { return { a: 1, b: 2 }; }
  }
  class ToJSON5Key {
    toJSON5(key: any) { return key === 'a' ? 1 : 2; }
  }
  class ToJSON11 {
    toJSON11() { return { a: 1, b: 2 }; }
  }
  class ToJSON11Key {
    toJSON11(key: any) { return key === 'a' ? 1 : 2; }
  }
  class Json11OverJson {
    toJSON() { return { a: 1, b: 2 }; }
    toJSON11() { return { a: 2, b: 2 }; }
  }
  class Json11OverJson5 {
    toJSON5() { return { a: 1, b: 2 }; }
    toJSON11() { return { a: 2, b: 2 }; }
  }
  class Json5OverJson {
    toJSON() { return { a: 1, b: 2 }; }
    toJSON5() { return { a: 2, b: 2 }; }
  }

  const vals: any[] = [
    new Date('2016-01-01T00:00:00.000Z'),
    new ToJSON(),
    { a: new ToJSONKey(), b: new ToJSONKey() },
    new ToJSON5(),
    { a: new ToJSON5Key(), b: new ToJSON5Key() },
    new ToJSON11(),
    { a: new ToJSON11Key(), b: new ToJSON11Key() },
    new Json11OverJson(),
    new Json11OverJson5(),
    new Json5OverJson(),
  ];

  it('matches the string serializer for each toJSON*/Date fixture', () => {
    for (const v of vals) {
      expect(dec(bytes(v, { raw: true }))).toBe(stringify(v));
    }
  });
});

describe('stringify(value, { raw: true }) — circular structure throws (byte ≡ string)', () => {
  /* The byte serializer carries its own stack.includes cycle guard; dropping it
   * would recurse to a RangeError instead of the documented TypeError. A cyclic
   * value can't go through the equality differential, so this is throw-parity. */
  it('throws the documented TypeError on a circular object', () => {
    const a: any = {};
    a.a = a;
    expect(() => stringify(a, { raw: true })).toThrow('Converting circular structure to JSON11');
  });

  it('throws the documented TypeError on a circular array', () => {
    const a: any = [];
    a[0] = a;
    expect(() => stringify(a, { raw: true })).toThrow('Converting circular structure to JSON11');
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
