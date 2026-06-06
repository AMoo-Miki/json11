/* Shared helpers for the byte-mode test suites: encoders, a deterministic PRNG,
 * adversarial value/string/document generators, and a `materialize` that turns a
 * raw-mode parse tree (with RawString leaves) back into a plain value for
 * comparison against the string parser. Not a test file (no test/spec suffix).
 */

import { RawString } from '../src/raw';

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
// ignoreBOM so comparisons preserve a leading U+FEFF instead of stripping it.
const _decoder = new TextDecoder('utf-8', { ignoreBOM: true });
export const dec = (b: Uint8Array): string => _decoder.decode(b);

/* Small deterministic PRNG (mulberry32) so fuzz failures are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: () => number, n: number): number => Math.floor(rng() * n);
export const pick = <T>(rng: () => number, arr: T[]): T => arr[randInt(rng, arr.length)];

/* Recursively convert a raw-mode parse tree into a plain value (RawString ->
 * decoded JS string) so it can be deep-compared against the string parser. */
export function materialize(value: any): any {
  if (value instanceof RawString) {
    return value.unsafeDecodeToString();
  }
  if (Array.isArray(value)) {
    return value.map(materialize);
  }
  if (value != null && typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) {
      out[k] = materialize(value[k]);
    }
    return out;
  }
  return value;
}

/* A curated corpus of valid JSON11 source strings, including JSON5/JSON11
 * quirks the serializer never emits (single quotes, unquoted keys, hex, bigint,
 * comments, trailing commas, \x escapes, leading/trailing decimal points,
 * unnecessary escapes, multibyte UTF-8, emoji, surrogate-pair escapes). */
export const CURATED: string[] = [
  '{}', '[]', 'null', 'true', 'false',
  '0', '1', '-1', '+1', '1.5', '-.5', '0.', '1e10', '1E-10', '+1.23e100',
  '0x1', '0xFF', '-0xdecaf', '0x0123456789abcdefABCDEF',
  'Infinity', '-Infinity', 'NaN', '-NaN',
  '1n', '-1n', '0x10n', '123456789012345678901234567890n',
  '"abc"', "'abc'", '""', "''",
  '"a\\"b"', "'a\\'b'", '"a\'b"', "'a\"b'",
  '"\\b\\f\\n\\r\\t\\v\\0"', "'\\x41\\x7f'", '"\\u0041\\u00e9\\u2028\\u2029"',
  '"\\uD83D\\uDE00"', '"caf\u00e9"', '"\u4e2d\u6587"', '"\u{1F600}\u{1F4A9}"',
  '"line\\\ncontinue"', "'\\a\\b\\c unnecessary'",
  '{a:1,b:2,c:3}', '{"a":1,\'b\':2,c:3}', '{$_:1,_$:2,a\u200C:3}',
  '{a\u200D:3}', '{a\\u200D:1}',
  '{\\u0061\\u0062:1}', '{ùńîċõďë:9}',
  '[1,2,3,]', '{a:1,}', '[ 1 , 2 , 3 ]',
  '{ a: [1, {b: "x"}], c: null }',
  '// comment\n{a:1}', '{a:1}//trailing', '/* multi\nline */[1,2]',
  '{\t\n\r a : /* c */ 1 }',
  '{"nested":{"deep":{"x":["a","b",["c"]]}}}',
  '{"k":"v with \\"quote\\" and \\\\ slash and / and \\/ "}',
  '[-0, 0, -0.0, 1.0, .25, 100.]',
  '"\\x00\\x01\\x1f"',
  '{"emoji":"\uD83D\uDE00","math":"\u2200x\u2208\u211d"}',
];

const SCALAR_CODE_POINTS = [
  0x00, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1f, 0x20,
  0x22, 0x27, 0x5c, 0x2f, 0x41, 0x7e, 0x7f, 0x80, 0xa0, 0xe9,
  0x2028, 0x2029, 0x20ac, 0x4e2d, 0xfeff, 0x1f600, 0x1f4a9, 0x10ffff,
];

/* A random Unicode-scalar string (never a lone surrogate, so it round-trips
 * through UTF-8 cleanly). */
export function randString(rng: () => number, maxLen = 20): string {
  const len = randInt(rng, maxLen);
  let s = '';
  for (let i = 0; i < len; i++) {
    if (rng() < 0.4) {
      s += String.fromCodePoint(pick(rng, SCALAR_CODE_POINTS));
    } else {
      let cp = randInt(rng, 0x110000);
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0x41; // skip lone surrogates
      s += String.fromCodePoint(cp);
    }
  }
  return s;
}

function randNumber(rng: () => number): number {
  switch (randInt(rng, 6)) {
    case 0: return randInt(rng, 1000);
    case 1: return -randInt(rng, 1000);
    case 2: return (rng() - 0.5) * 1e6;
    case 3: return rng();
    case 4: return [0, -0, Infinity, -Infinity, NaN][randInt(rng, 5)];
    default: return randInt(rng, 2 ** 31);
  }
}

/* A random JSON11-serializable value (objects, arrays, strings, numbers,
 * bigints, booleans, null), bounded in depth. */
export function randValue(rng: () => number, depth = 0): any {
  if (depth > 4) {
    return randString(rng);
  }
  switch (randInt(rng, 9)) {
    case 0: return null;
    case 1: return rng() < 0.5;
    case 2: return randNumber(rng);
    case 3: return randString(rng);
    case 4: return BigInt(randInt(rng, 2 ** 30)) * BigInt(randInt(rng, 2 ** 30));
    case 5:
    case 6: {
      const n = randInt(rng, 5);
      const arr: any[] = [];
      for (let i = 0; i < n; i++) arr.push(randValue(rng, depth + 1));
      return arr;
    }
    default: {
      const n = randInt(rng, 5);
      const obj: any = {};
      for (let i = 0; i < n; i++) {
        obj[randString(rng, 8) || `k${i}`] = randValue(rng, depth + 1);
      }
      return obj;
    }
  }
}
