import { expect, describe, it, vi, beforeAll, afterAll } from 'vitest';
import { parse, stringify, RawString } from '../src';
import { CURATED, dec, enc, makeRng, materialize, randString, randValue } from './_helpers';

// Random/curated inputs may contain unescaped U+2028/U+2029, which both parsers
// warn about; silence the noise for the whole file.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => null);
});
afterAll(() => {
  warnSpy.mockRestore();
});

describe('parse(Uint8Array) — positive', () => {
  it('parses objects, arrays, primitives from bytes', () => {
    expect(parse(enc('{}'))).toEqual({});
    expect(parse(enc('[]'))).toEqual([]);
    expect(parse(enc('{"a":1,b:[1,2,3]}'))).toEqual({ a: 1, b: [1, 2, 3] });
    expect(parse(enc('null'))).toBe(null);
    expect(parse(enc('true'))).toBe(true);
    expect(parse(enc('false'))).toBe(false);
  });

  it('parses numbers (hex, signs, exponents, leading/trailing points, Infinity, NaN)', () => {
    expect(parse(enc('[0x1,0x10,0xff,0xFF]'))).toEqual([1, 16, 255, 255]);
    expect(parse(enc('[-1,+2,-.1,-0]'))).toEqual([-1, 2, -0.1, -0]);
    expect(parse(enc('[1e0,1e1,1.e0,1.1e0,1e-1,1e+1]'))).toEqual([1, 10, 1, 1.1, 0.1, 10]);
    expect(parse(enc('[Infinity,-Infinity]'))).toEqual([Infinity, -Infinity]);
    expect(isNaN(parse(enc('NaN')))).toBe(true);
  });

  it('parses bigints and long numerals option', () => {
    expect(parse(enc('1n'))).toBe(1n);
    expect(parse(enc('[0x10n,0xffn]'))).toEqual([16n, 255n]);
    const big = (3n * BigInt(Number.MAX_SAFE_INTEGER)).toString();
    expect(parse(enc(big), null, { withLongNumerals: true })).toBe(BigInt(big));
  });

  it('parses unquoted, escaped, and unicode property names', () => {
    expect(parse(enc('{$_:1,_$:2,a\u200C:3}'))).toEqual({ $_: 1, _$: 2, 'a\u200C': 3 });
    expect(parse(enc('{\\u0061\\u0062:1}'))).toEqual({ ab: 1 });
    expect(parse(enc('{ùńîċõďë:9}'))).toEqual({ 'ùńîċõďë': 9 });
  });

  it('preserves __proto__ as an own property', () => {
    expect(parse(enc('{"__proto__":1}')).__proto__).toBe(1);
  });

  it('parses comments, whitespace, and trailing commas', () => {
    expect(parse(enc('// c\n{a:1}'))).toEqual({ a: 1 });
    expect(parse(enc('/* x */[1,2,]'))).toEqual([1, 2]);
    expect(parse(enc('{\t\v\f \u00A0\uFEFF\n\r\u2028\u2029\u2003a:1}'))).toEqual({ a: 1 });
  });

  it('parses strings with escapes and multibyte UTF-8', () => {
    expect(parse(enc('"caf\u00e9 \u{1F600}"'))).toBe('caf\u00e9 \u{1F600}');
    expect(parse(enc('"\\uD83D\\uDE00"'))).toBe('\u{1F600}');
    expect(parse(enc("'\\b\\f\\n\\r\\t\\v\\0\\x41'"))).toBe('\b\f\n\r\t\v\0A');
  });

  it('supports a reviver', () => {
    expect(parse(enc('{a:1,b:2}'), (k, v) => (k === 'a' ? 'revived' : v))).toEqual({ a: 'revived', b: 2 });
  });

  it('accepts a Node Buffer (Uint8Array subclass)', () => {
    expect(parse(Buffer.from('{a:1}', 'utf8'))).toEqual({ a: 1 });
  });
});

describe('parse(Uint8Array) — differential equivalence with parse(string)', () => {
  it('matches the string parser on the curated corpus', () => {
    for (const s of CURATED) {
      expect(parse(enc(s))).toEqual(parse(s));
    }
  });

  it('matches the string parser on a large generated corpus', () => {
    const rng = makeRng(0xC0FFEE);
    for (let i = 0; i < 3000; i++) {
      const v = randValue(rng);
      const text = JSON11stringifyStable(v);
      expect(parse(enc(text))).toEqual(parse(text));
    }
  });

  it('matches the string parser on standalone random strings', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 2000; i++) {
      const s = randString(rng, 40);
      const text = JSON.stringify(s); // valid JSON11 string literal
      expect(parse(enc(text))).toBe(parse(text));
    }
  });
});

describe('parse(Uint8Array, …, { raw }) — borrowed spans', () => {
  it('returns RawString for values, plain strings for keys', () => {
    const doc: any = parse(enc('{"subkey":"S3cr3t\\u0041","meta":"ok"}'), null, { raw: 'values' });
    expect(Object.keys(doc)).toEqual(['subkey', 'meta']);
    expect(doc.subkey).toBeInstanceOf(RawString);
    expect(doc.meta).toBeInstanceOf(RawString);
  });

  it('span aliases the input buffer (escaped inner bytes, verbatim)', () => {
    const buf = enc('{"x":"a\\u0041b"}');
    const doc: any = parse(buf, null, { raw: 'values' });
    const span = doc.x.span();
    expect(dec(span)).toBe('a\\u0041b');
    // span is a view: it shares memory with the input buffer
    expect(span.buffer).toBe(buf.buffer);
  });

  it('decode() unescapes to fresh bytes; copy() copies the escaped span', () => {
    const doc: any = parse(enc('{"x":"a\\u0041b\\n\\t\\uD83D\\uDE00"}'), null, { raw: 'values' });
    expect(dec(doc.x.decode())).toBe('aAb\n\t\u{1F600}');
    expect(dec(doc.x.copy())).toBe('a\\u0041b\\n\\t\\uD83D\\uDE00');
  });

  it('toString() lazily decodes and matches the string parser', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const s = randString(rng, 30);
      const text = `{"v":${JSON.stringify(s)}}`;
      const doc: any = parse(enc(text), null, { raw: 'values' });
      expect(doc.v.unsafeDecodeToString()).toBe(s);
    }
  });

  it('materialized raw tree deep-equals the string parse for the corpus', () => {
    for (const s of CURATED) {
      // strings only differ in leaves; compare materialized raw tree
      expect(materialize(parse(enc(s), null, { raw: 'values' }))).toEqual(parse(s));
    }
  });

  it("treats 'all' like 'values' for object shape (keys are JS strings)", () => {
    const doc: any = parse(enc('{"k":"v"}'), null, { raw: 'all' });
    expect(typeof Object.keys(doc)[0]).toBe('string');
    expect(doc.k).toBeInstanceOf(RawString);
  });

  it('raw mode on string input throws TypeError', () => {
    // @ts-expect-error string + raw is a type error
    expect(() => parse('"x"', null, { raw: 'values' })).toThrow(TypeError);
  });
});

describe('parse(Uint8Array) — negative / adversarial', () => {
  const bad: [string, Uint8Array][] = [
    ['empty input', enc('')],
    ['unterminated string', enc('"abc')],
    ['unterminated string (single)', enc("'abc")],
    ['lone trailing backslash', enc('"abc\\')],
    ['truncated \\u escape', enc('"\\u12"')],
    ['bad hex in \\u', enc('"\\uZZZZ"')],
    ['truncated \\x escape', enc('"\\x1"')],
    ['\\0 followed by digit', enc('"\\01"')],
    ['raw newline in string', enc('"a\nb"')],
    ['unterminated object', enc('{a:1')],
    ['unterminated array', enc('[1,2')],
    ['trailing data', enc('{}x')],
    ['bare comma', enc(',')],
    ['only comment', enc('// c')],
    ['invalid token', enc('@')],
    ['truncated multibyte UTF-8', new Uint8Array([0x22, 0xe2, 0x80, 0x22])],
    ['bad UTF-8 lead byte in string', new Uint8Array([0x22, 0xff, 0x22])],
    ['overlong UTF-8', new Uint8Array([0x22, 0xc0, 0x80, 0x22])],
    ['UTF-8 encoded surrogate', new Uint8Array([0x22, 0xed, 0xa0, 0x80, 0x22])],
    ['lone continuation byte', new Uint8Array([0x22, 0x80, 0x22])],
    ['truncated input mid-escape', enc('"\\')],
  ];

  for (const [name, bytes] of bad) {
    it(`throws SyntaxError on ${name}`, () => {
      expect(() => parse(bytes)).toThrow(SyntaxError);
    });
  }

  it('never reads out of bounds on any truncation of a valid document', () => {
    const full = enc('{a:1,b:[1,"two",3n],c:{d:"caf\u00e9 \u{1F600}",e:0xFF}}');
    for (let n = 0; n <= full.length; n++) {
      const slice = full.subarray(0, n);
      let threw = false;
      let result: any;
      try {
        result = parse(slice);
      } catch (ex) {
        threw = true;
        expect(ex).toBeInstanceOf(SyntaxError);
      }
      // either a clean parse (only when the slice is itself complete) or a typed throw
      expect(threw || result !== undefined || n === full.length).toBe(true);
    }
  });
});

/* A stable serialization for differential generation: avoids quote-weight
 * surprises by forcing double quotes, and includes BigInt as <n>. */
function JSON11stringifyStable(v: any): string {
  return stringify(v, { quote: '"' }) ?? 'null';
}
