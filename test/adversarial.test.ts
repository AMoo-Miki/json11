/* Additional adversarial coverage for the byte path, chosen to NOT overlap the
 * existing negative/fuzz suites (byteParse, fuzz, raw, heapHygiene). New angles:
 *   1. UTF-8 boundary forms decodeUtf8 must reject/accept (overlong 3/4-byte,
 *      out-of-range, 5/6-byte leads, C1, and the exact max scalar U+10FFFF).
 *   2. Malformed surrogate *escapes* decoded by the byte path must agree with the
 *      string path (lone/half/reversed pairs -> U+FFFD parity).
 *   3. Malformed number/literal tokens in bytes -> typed SyntaxError.
 *   4. Prototype-pollution safety on the byte path.
 *   5. Line-continuation variants (LF/CRLF/CR/U+2028/U+2029) decode parity.
 *   6. Pathological-but-valid inputs terminate safely and correctly (bounds).
 *   7. Raw-mode invalid property names -> typed SyntaxError.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { parse, RawString } from '../src';
import { enc } from './_helpers';

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => null);
});
afterAll(() => warn.mockRestore());

/* Concatenate strings (utf8-encoded) and raw byte arrays into one buffer. */
function buf(...parts: (string | Uint8Array | number[])[]): Uint8Array {
  const bins = parts.map((p) =>
    typeof p === 'string' ? enc(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  );
  let n = 0;
  for (const b of bins) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of bins) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

// 1. UTF-8 boundary forms inside a string value -------------------------------

describe('adversarial: UTF-8 boundary forms (decodeUtf8 accept/reject)', () => {
  const rejectInString: [string, number[]][] = [
    ['overlong 2-byte (C1 80 -> U+0040)', [0xc1, 0x80]],
    ['overlong 3-byte (E0 80 80)', [0xe0, 0x80, 0x80]],
    ['overlong 4-byte (F0 80 80 80)', [0xf0, 0x80, 0x80, 0x80]],
    ['5-byte lead (F8 ...)', [0xf8, 0x88, 0x80, 0x80, 0x80]],
    ['6-byte lead (FC ...)', [0xfc, 0x84, 0x80, 0x80, 0x80, 0x80]],
    ['out-of-range (F4 90 80 80 -> U+110000)', [0xf4, 0x90, 0x80, 0x80]],
    ['bad continuation (E2 28 A1)', [0xe2, 0x28, 0xa1]],
    ['truncated 4-byte at limit (F0 9F 98)', [0xf0, 0x9f, 0x98]],
  ];
  for (const [name, bytes] of rejectInString) {
    it(`rejects ${name} as a string value`, () => {
      expect(() => parse(buf('{"k":"', bytes, '"}'), null, { raw: 'values' })).toThrow(SyntaxError);
    });
  }

  it('rejects malformed UTF-8 in a structural position too (outside strings)', () => {
    expect(() => parse(buf('[', [0xe0, 0x80, 0x80], ']'))).toThrow(SyntaxError);
  });

  it('accepts the exact maximum scalar U+10FFFF (F4 8F BF BF) and decodes it verbatim', () => {
    const max = [0xf4, 0x8f, 0xbf, 0xbf];
    const doc: any = parse(buf('{"k":"', max, '"}'), null, { raw: 'values' });
    expect(Array.from(doc.k.decode())).toEqual(max);
    expect(doc.k.unsafeDecodeToString()).toBe('\u{10FFFF}');
  });

  it('accepts U+0080, U+07FF, U+0800, U+FFFF boundary scalars', () => {
    const text = '"\u0080\u07ff\u0800\uffff"';
    const doc: any = parse(buf('{"k":', enc(text), '}'), null, { raw: 'values' });
    expect(doc.k.unsafeDecodeToString()).toBe('\u0080\u07ff\u0800\uffff');
    expect(Array.from(doc.k.decode())).toEqual(Array.from(enc('\u0080\u07ff\u0800\uffff')));
  });
});

// 2. Malformed surrogate escapes: byte path vs string path parity -------------

describe('adversarial: malformed surrogate escapes decode with U+FFFD parity', () => {
  const cases = [
    '\\uD83D', // lone high
    '\\uDE00', // lone low
    '\\uD83D\\u0041', // high + non-low (BMP)
    '\\uD83Dx', // high + literal char
    '\\uDE00\\uD83D', // low then high (reversed)
    'ok\\uD83D', // high at end
    '\\uD83D\\uD83D\\uDE00', // high, then a valid pair
    '\\uDBFF\\uDFFF', // valid astral pair (max) — sanity within the same test
  ];
  for (const inner of cases) {
    it(`byte decode matches string parse for "${inner}"`, () => {
      const text = `{"k":"${inner}"}`;
      const expected = (parse(text) as any).k as string;
      const doc: any = parse(enc(text), null, { raw: 'values' });
      expect(doc.k.unsafeDecodeToString()).toBe(expected);
      expect(Array.from(doc.k.decode())).toEqual(Array.from(enc(expected)));
    });
  }
});

// 3. Malformed number / literal tokens ---------------------------------------

describe('adversarial: malformed number/literal tokens throw SyntaxError', () => {
  const bad = [
    '0x', '0xg', '0xn', '0x1.5',
    '.', '.e1', '+', '-', '+.', '-.',
    '1e', '1e+', '1e-', '1.e', '1..2', '1.2.3',
    '00', '01', '08', '+0123',
    'Infinityx', 'NaNx', 'truex', 'fals', 'nul', 'tru',
    '1n.5', '1.5n', '0xFFn5',
    'I', 'N', '- 1',
  ];
  for (const t of bad) {
    it(`throws on \`${t}\``, () => {
      expect(() => parse(enc(t))).toThrow(SyntaxError);
    });
  }

  it('accepts the valid neighbors of those edges', () => {
    expect(parse(enc('0x1'))).toBe(1);
    expect(parse(enc('0x1n'))).toBe(1n);
    expect(parse(enc('1.5'))).toBe(1.5);
    expect(parse(enc('1e1'))).toBe(10);
    expect(parse(enc('1e+1'))).toBe(10);
    expect(parse(enc('-0'))).toBe(-0);
  });
});

// 4. Prototype-pollution safety on the byte path ------------------------------

describe('adversarial: byte parse does not pollute Object.prototype', () => {
  const dangerous = [
    '{"__proto__":{"polluted":1}}',
    '{"__proto__":{"polluted":1},"x":2}',
    '{"constructor":{"prototype":{"polluted":1}}}',
    '{a:{__proto__:{polluted:1}}}',
  ];

  for (const t of dangerous) {
    it(`stays clean for ${t}`, () => {
      expect(Object.prototype).not.toHaveProperty('polluted');
      const doc = parse(enc(t));
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
      void doc;
      expect(Object.prototype).not.toHaveProperty('polluted');
    });
  }

  it('keeps __proto__ as a real own property (not a prototype mutation)', () => {
    const doc: any = parse(enc('{"__proto__":1}'));
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(doc, '__proto__')).toBe(true);
    expect(doc.__proto__).toBe(1);
  });

  it('is safe in raw mode too', () => {
    const doc: any = parse(enc('{"__proto__":{"polluted":"x"}}'), null, { raw: 'values' });
    expect((Object.prototype as any).polluted).toBeUndefined();
    void doc;
  });
});

// 5. Line-continuation variants: decode parity -------------------------------

describe('adversarial: escaped line continuations decode like the string path', () => {
  const variants: [string, string][] = [
    ['LF', '"a\\\nb"'],
    ['CRLF', '"a\\\r\nb"'],
    ['CR', '"a\\\rb"'],
    ['U+2028', '"a\\\u2028b"'],
    ['U+2029', '"a\\\u2029b"'],
    ['trailing continuation', '"ab\\\n"'],
    ['only continuation', '"\\\n"'],
  ];
  for (const [name, inner] of variants) {
    it(`handles a ${name} continuation`, () => {
      const text = `{"k":${inner}}`;
      const expected = (parse(text) as any).k as string;
      const doc: any = parse(enc(text), null, { raw: 'values' });
      expect(doc.k.unsafeDecodeToString()).toBe(expected);
      expect(Array.from(doc.k.decode())).toEqual(Array.from(enc(expected)));
    });
  }
});

// 6. Pathological-but-valid inputs terminate safely and correctly ------------

describe('adversarial: pathological valid inputs are bounded and correct', () => {
  it('a megabyte of leading whitespace before the value', () => {
    expect(parse(buf(' '.repeat(1_000_000), '1'))).toBe(1);
  });

  it('a huge comment body', () => {
    expect(parse(buf('/*', 'x'.repeat(1_000_000), '*/ 1'))).toBe(1);
  });

  it('an enormous numeral does not hang', () => {
    const n: any = parse(enc('9'.repeat(100_000)));
    expect(typeof n).toBe('number');
    expect(n).toBe(Infinity);
  });

  it('a very long property name', () => {
    const key = 'a'.repeat(100_000);
    const doc: any = parse(buf('{', key, ':1}'));
    expect(doc[key]).toBe(1);
  });

  it('a very long string value yields a same-length span/decoded copy without a String', () => {
    const big = 'a'.repeat(1_000_000);
    const doc: any = parse(buf('{"k":"', big, '"}'), null, { raw: 'values' });
    expect(doc.k).toBeInstanceOf(RawString);
    expect(doc.k.span().length).toBe(1_000_000);
    expect(doc.k.decode().length).toBe(1_000_000);
  });

  it('many sibling members do not blow up', () => {
    const parts: string[] = ['['];
    for (let i = 0; i < 50_000; i++) parts.push(i ? ',1' : '1');
    parts.push(']');
    const arr = parse(buf(parts.join(''))) as number[];
    expect(arr.length).toBe(50_000);
  });
});

// 7. Raw-mode invalid property names -----------------------------------------

describe('adversarial: invalid property names throw in raw mode', () => {
  const bad = [
    '{\\u0020:1}', // escaped space is not a valid identifier start
    '{1a:1}', // identifier cannot start with a digit
    '{a a:1}', // missing colon between two identifiers
    '{:1}', // missing key
    '{,}', // bare comma
    '{a:1 b:2}', // missing comma between members
    '{\\u{41}:1}', // \u{...} form not valid for identifier escapes
  ];
  for (const t of bad) {
    it(`throws on ${t}`, () => {
      expect(() => parse(enc(t), null, { raw: 'values' })).toThrow(SyntaxError);
    });
  }

  it('still accepts the valid escaped/unicode identifier forms', () => {
    expect(parse(enc('{\\u0061:1}'), null, { raw: 'values' })).toEqual({ a: 1 });
    expect(Object.keys(parse(enc('{$_\\u200C:1}'), null, { raw: 'values' }) as object)).toEqual(['$_\u200C']);
  });
});
