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
