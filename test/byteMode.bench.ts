/* Micro-benchmarks comparing the byte path against the string path. Run with
 * `npm run bench`. The byte path should be in the same ballpark as the string
 * path (it is separate code and must not regress the string paths).
 */
import { bench, describe } from 'vitest';
import { parse, stringify, RawValue } from '../src';

const sample = {
  id: 1186694007922679455n,
  name: 'json11 byte-mode benchmark',
  tags: ['a', 'b', 'c', "quote'd", 'uni\u00e9\u{1F600}'],
  nested: { x: [1, 2, 3, { y: 'deep "value" with \\ and \n' }], z: null },
  flags: [true, false, null],
  blob: 'a fairly long string value '.repeat(20),
};

const text = stringify(sample, { withBigInt: true })!;
const bytes = new TextEncoder().encode(text);
const decoded = stringify(sample, { raw: true })!; // warm

describe('parse', () => {
  bench('parse(string)', () => {
    parse(text);
  });
  bench('parse(bytes) raw:off', () => {
    parse(bytes);
  });
  bench('parse(bytes) raw:values (borrowed spans)', () => {
    parse(bytes, null, { raw: 'values' });
  });
});

describe('stringify', () => {
  bench('stringify(string)', () => {
    stringify(sample);
  });
  bench('stringify(bytes)', () => {
    stringify(sample, { raw: true });
  });
});

describe('extract one value as bytes (the consumer use case)', () => {
  const doc: any = parse(bytes, null, { raw: 'values' });
  bench('lift span + reinject (no String for the value)', () => {
    stringify({ moved: RawValue.escaped(doc.name.span(), doc.name.quote) }, { raw: true });
  });
  void decoded;
});

/* Deep nesting separates the two byte-serializer cost classes. Bare-identifier
 * keys are written before their value, so the whole document streams out in one
 * pass. A quoted key (forced here by quoteNames) must be spliced in front of its
 * already-written value to match the string serializer's value-before-key quote
 * choice, which re-shifts the value subtree at every level — so the cost grows
 * with depth. The bare-key pair is the O(n) control; the gap to the quoted-key
 * pair is the amplification this watches for. */
const deepNest = (() => {
  let node: any = { leaf: 'a fairly long leaf payload '.repeat(20) };
  for (let level = 0; level < 200; level++) {
    node = { label: `level "${level}" boundary`, child: node };
  }
  return node;
})();

describe('stringify deep-nest', () => {
  bench('stringify(string) bare keys', () => {
    stringify(deepNest);
  });
  bench('stringify(bytes) bare keys', () => {
    stringify(deepNest, { raw: true });
  });
  bench('stringify(string) quoted keys', () => {
    stringify(deepNest, { quoteNames: true });
  });
  bench('stringify(bytes) quoted keys', () => {
    stringify(deepNest, { raw: true, quoteNames: true });
  });
});
