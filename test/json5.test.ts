import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../src';

const vectorRoot = fileURLToPath(new URL('./fixtures/json5-tests/', import.meta.url));
const vectorDirectories = ['arrays', 'comments', 'misc', 'new-lines', 'numbers', 'objects', 'strings', 'todo'];
// Generated once with json5@2.2.3; keeping it here avoids a competing dev dependency.
const expectedOutputs = JSON.parse(
  readFileSync(new URL('./fixtures/json5-expected.json', import.meta.url), 'utf8'),
) as Record<string, TaggedValue>;

type TaggedValue =
  | ['null']
  | ['boolean', boolean]
  | ['string', string]
  | ['number', string]
  | ['array', TaggedValue[]]
  | ['object', [string, TaggedValue][]];

function listVectors(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listVectors(path);
    return /\.(?:json|json5|js|txt)$/u.test(entry.name) ? [path] : [];
  });
}

function numberToken(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Object.is(value, -0)) return '-0';

  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toTagged(value: unknown): TaggedValue {
  if (value === null) return ['null'];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'number') return ['number', numberToken(value)];
  if (Array.isArray(value)) return ['array', value.map(toTagged)];
  if (typeof value === 'object') {
    return [
      'object',
      Object.keys(value)
        .sort()
        .map((key) => [key, toTagged((value as Record<string, unknown>)[key])]),
    ];
  }
  throw new TypeError(`Unsupported parsed value type: ${typeof value}`);
}

const vectors = vectorDirectories
  .flatMap((directory) => listVectors(join(vectorRoot, directory)))
  .map((path) => ({
    id: relative(vectorRoot, path).split(sep).join('/'),
    path,
    accepts: ['.json', '.json5'].includes(extname(path)),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

const acceptedVectors = vectors.filter(({ accepts }) => accepts);
const rejectedVectors = vectors.filter(({ accepts }) => !accepts);

describe('JSON5 test vectors', () => {
  describe.concurrent('valid inputs', () => {
    it.each(acceptedVectors)('parses $id', ({ id, path }) => {
      const input = readFileSync(path, 'utf8');
      const actual = parse(input);
      expect(expectedOutputs[id]).toBeDefined();
      expect(toTagged(actual)).toEqual(expectedOutputs[id]);
    });
  });

  describe.concurrent('invalid inputs', () => {
    it.each(rejectedVectors)('rejects $id', ({ path }) => {
      expect(() => parse(readFileSync(path, 'utf8'))).toThrow(SyntaxError);
    });
  });
});
