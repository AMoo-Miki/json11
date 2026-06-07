import { expect, describe, it, vi, beforeAll, afterAll } from 'vitest';
import { parse, stringify, RawValue, RawString } from '../src';
import { dec, enc, makeRng, randInt, randString, randValue } from './_helpers';

// Adversarial inputs frequently contain unescaped U+2028/U+2029, which the
// parser warns about (matching the string parser); silence that here.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => null);
});
afterAll(() => {
  warnSpy.mockRestore();
});

/* The byte parser is a hostile-input parser. These property tests assert that no
 * input can make it read out of bounds, hang, or return a partial/garbage value:
 * every call must either return a well-formed result or throw a typed error
 * (SyntaxError for malformed JSON11, TypeError for misuse). Any other thrown type
 * (e.g. a RangeError leaking from a typed-array access, or a TypeError from
 * reading a property of undefined) would indicate an unchecked bound. */
/* `context` is a lazy label (only invoked on failure) so a red run prints the
 * seed, iteration, and offending bytes — turning a 20000-iteration failure into
 * an immediately reproducible single case — at no cost on the happy path. */
function assertSafe(bytes: Uint8Array, context?: () => string): void {
  try {
    parse(bytes);
  } catch (ex) {
    if (!(ex instanceof SyntaxError) && !(ex instanceof TypeError)) {
      const where = context ? ` [${context()}]` : '';
      const name = ex instanceof Error ? ex.constructor.name : typeof ex;
      const message = ex instanceof Error ? ex.message : String(ex);
      throw new Error(`unexpected error type ${name}${where}: ${message}`, { cause: ex });
    }
  }
}

describe('fuzz — hostile bytes never read OOB / hang / return garbage', () => {
  it('survives fully random byte buffers', () => {
    const seed = 0x1234;
    const rng = makeRng(seed);
    for (let i = 0; i < 20000; i++) {
      const len = randInt(rng, 64);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = randInt(rng, 256);
      assertSafe(buf, () => `seed=${seed} i=${i} bytes=[${Array.from(buf)}]`);
    }
  });

  it('survives random ASCII drawn from the JSON11 alphabet', () => {
    const seed = 0x9999;
    const rng = makeRng(seed);
    const alphabet = '{}[]():,"\'\\/0123456789.+-eExXnabfrtuvITNW \t\n\r';
    for (let i = 0; i < 20000; i++) {
      const len = randInt(rng, 48);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[randInt(rng, alphabet.length)];
      const buf = enc(s);
      assertSafe(buf, () => `seed=${seed} i=${i} bytes=[${Array.from(buf)}]`);
    }
  });

  it('survives single-byte mutations of a valid document', () => {
    const seed = 0x55;
    const rng = makeRng(seed);
    const base = enc('{a:1,b:[1,"two",3n],c:{d:"caf\u00e9 \u{1F600}",e:0xFF},f:[true,false,null]}');
    for (let i = 0; i < 10000; i++) {
      const buf = base.slice();
      const flips = 1 + randInt(rng, 4);
      for (let k = 0; k < flips; k++) {
        buf[randInt(rng, buf.length)] = randInt(rng, 256);
      }
      assertSafe(buf, () => `seed=${seed} i=${i} bytes=[${Array.from(buf)}]`);
    }
  });

  it('survives truncations and tail-garbage of a valid document', () => {
    const seed = 0x77;
    const rng = makeRng(seed);
    const base = enc('{"k":"v\\u0041","n":[1,2,3],"s":"\u{1F4A9}"}');
    for (let n = 0; n <= base.length; n++) {
      const slice = base.subarray(0, n);
      assertSafe(slice, () => `truncation n=${n} bytes=[${Array.from(slice)}]`);
    }
    for (let i = 0; i < 5000; i++) {
      const tail = new Uint8Array(randInt(rng, 8));
      for (let j = 0; j < tail.length; j++) tail[j] = randInt(rng, 256);
      const buf = new Uint8Array(base.length + tail.length);
      buf.set(base);
      buf.set(tail, base.length);
      assertSafe(buf, () => `seed=${seed} tail-garbage i=${i} bytes=[${Array.from(buf)}]`);
    }
  });

  it('survives adversarial escape and UTF-8 fragments inside strings', () => {
    const seed = 0xABCD;
    const rng = makeRng(seed);
    const frags = ['\\', '\\u', '\\u1', '\\uD83D', '\\uDE00', '\\x', '\\x4', '\\0', '\\01',
      '\xff', '\xe2\x80', '\xc0\x80', '\xed\xa0\x80', '\n', '\r', '\u2028', '\\\n', '"', "'"];
    for (let i = 0; i < 20000; i++) {
      const n = randInt(rng, 6);
      let body = '';
      for (let j = 0; j < n; j++) body += frags[randInt(rng, frags.length)];
      // wrap as a string value in an object; use latin1 so \xNN are raw bytes
      const buf = Buffer.from(`{"v":"${body}"}`, 'latin1');
      assertSafe(buf, () => `seed=${seed} i=${i} bytes=[${Array.from(buf)}]`);
    }
  });

  it('does not stack-overflow on deeply nested structures', () => {
    const depth = 5000;
    expect(() => parse(enc('['.repeat(depth) + ']'.repeat(depth)))).not.toThrow(RangeError);
    const obj = '{a:'.repeat(depth) + '1' + '}'.repeat(depth);
    expect(() => parse(enc(obj))).not.toThrow(RangeError);
  });
});

describe('fuzz — differential parity and round trips', () => {
  it('parse(bytes) deep-equals parse(string) for random documents', () => {
    const rng = makeRng(0x2468);
    for (let i = 0; i < 5000; i++) {
      const text = stringify(randValue(rng), { quote: '"' }) ?? 'null';
      expect(parse(enc(text))).toEqual(parse(text));
    }
  });

  it('byte stringify == utf8(string stringify) for random values', () => {
    const rng = makeRng(0x13579);
    for (let i = 0; i < 5000; i++) {
      const v = randValue(rng);
      const str = stringify(v) ?? '';
      const raw = stringify(v, { raw: true });
      expect(dec(raw ?? new Uint8Array())).toBe(str);
    }
  });

  it('full round trip: value -> bytes -> parse(raw) -> reinject -> bytes -> parse', () => {
    const rng = makeRng(0x31337);
    for (let i = 0; i < 2000; i++) {
      const secret = randString(rng, 40);
      const docBytes = stringify({ subkey: secret }, { raw: true })!;
      const parsed = parse(docBytes, null, { raw: 'values' }) as Record<string, RawString>;
      const moved = stringify({ out: RawValue.escaped(parsed.subkey.span(), parsed.subkey.quote) }, { raw: true })!;
      const re = parse(moved, null, { raw: 'values' }) as Record<string, RawString>;
      expect(dec(re.out.decode())).toBe(secret);
    }
  });
});
