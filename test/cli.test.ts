import { expect, describe, it } from 'vitest';
import { parseArgs, buildStringifyOptions, transform, usageText } from '../src/cli';

/* Drives the CLI's arg-handling and transform pipeline in-process. cli.ts only
 * runs its main flow when it is the process entry (isMainModule), so importing
 * these functions here is side-effect-free — no stdin read, no arg parsing of
 * vitest's own argv. The leading two argv slots stand in for `node` + script. */
function args(...flags: string[]) {
  return parseArgs(['node', 'json11', ...flags]);
}

describe('cli arg parsing', () => {
  it('maps every output flag to a stringify option', () => {
    expect(buildStringifyOptions(args())).toEqual({});

    expect(buildStringifyOptions(args('--space', '2'))).toEqual({ space: 2 });
    expect(buildStringifyOptions(args('-s', 'tab'))).toEqual({ space: '\t' });
    expect(buildStringifyOptions(args('-s', 't'))).toEqual({ space: '\t' });

    expect(buildStringifyOptions(args('--quote', '"'))).toEqual({ quote: '"' });
    expect(buildStringifyOptions(args('--quote-names'))).toEqual({ quoteNames: true });
    expect(buildStringifyOptions(args('--no-bigint-suffix'))).toEqual({ withBigInt: false });
    expect(buildStringifyOptions(args('--trailing-comma'))).toEqual({ trailingComma: true });
    expect(buildStringifyOptions(args('--legacy-escapes'))).toEqual({ withLegacyEscapes: true });
    expect(buildStringifyOptions(args('--non-finite', 'null'))).toEqual({ nonFinite: 'null' });
    expect(buildStringifyOptions(args('--pure-json'))).toEqual({ pureJson: true });
  });

  it('rejects an invalid --quote value with a clear typed error', () => {
    expect(() => buildStringifyOptions(args('--quote', 'x'))).toThrow(TypeError);
    expect(() => buildStringifyOptions(args('--quote', '""'))).toThrow(/single ' or "/);
  });

  it('rejects an invalid --non-finite mode with a clear typed error', () => {
    expect(() => buildStringifyOptions(args('--non-finite', 'drop'))).toThrow(TypeError);
    expect(() => buildStringifyOptions(args('--non-finite', 'drop'))).toThrow(/literal, null, throw/);
  });
});

describe('cli BigInt serialization (the MED-4 crash)', () => {
  /* The README documents { "n": 1186694007922679455n } as valid input. The old
   * CLI serialized with global JSON.stringify, which throws on a BigInt. */
  const bigintDoc = '{ "n": 1186694007922679455n }';

  it('round-trips a BigInt by default (with the n suffix)', () => {
    expect(transform(bigintDoc, args())).toBe('{n:1186694007922679455n}');
  });

  it('emits a bare integer with --no-bigint-suffix', () => {
    expect(transform(bigintDoc, args('--no-bigint-suffix'))).toBe('{n:1186694007922679455}');
  });
});

describe('cli quote flags', () => {
  it('--quote \'"\' forces double quotes', () => {
    expect(transform("{a:'hi'}", args())).toBe("{a:'hi'}");
    expect(transform("{a:'hi'}", args('--quote', '"'))).toBe('{a:"hi"}');
  });

  it('--quote-names quotes object keys', () => {
    expect(transform('{a:1}', args())).toBe('{a:1}');
    expect(transform('{a:1}', args('--quote-names'))).toBe("{'a':1}");
    expect(transform('{a:1}', args('--quote', '"', '--quote-names'))).toBe('{"a":1}');
  });
});

describe('cli --non-finite (generate valid JSON from Infinity/NaN)', () => {
  const doc = '{ a: Infinity, b: NaN }';

  it('emits Infinity/NaN literally by default', () => {
    expect(transform(doc, args())).toBe('{a:Infinity,b:NaN}');
  });

  it("coerces to null with --non-finite null", () => {
    expect(transform(doc, args('--non-finite', 'null'))).toBe('{a:null,b:null}');
  });

  it('throws with --non-finite throw', () => {
    expect(() => transform(doc, args('--non-finite', 'throw'))).toThrow(/non-finite/);
  });
});

describe('cli --pure-json (strict valid JSON, overrides everything)', () => {
  it('produces strict JSON that global JSON.parse accepts', () => {
    const out = transform("{ 'a-b': 1, n: Infinity, big: 10n }", args('--pure-json'));
    expect(out).toBe('{"a-b":1,"n":null,"big":10}');
    expect(() => JSON.parse(out!)).not.toThrow();
  });

  it('wins over conflicting granular flags', () => {
    const out = transform('{ a: 1n, b: NaN }', args('--quote', "'", '--non-finite', 'literal', '--pure-json'));
    expect(out).toBe('{"a":1,"b":null}');
  });
});

describe('cli validate path', () => {
  it('emits nothing on valid input (success)', () => {
    expect(transform('{a:1}', args('--validate'))).toBeUndefined();
    expect(transform('{ "n": 1186694007922679455n }', args('-v'))).toBeUndefined();
  });

  it('throws on invalid input (non-zero exit)', () => {
    expect(() => transform('{a:}', args('--validate'))).toThrow();
  });
});

describe('cli --help (MED-3: help lists every accepted flag)', () => {
  it('mentions every flag the parser accepts', () => {
    const help = usageText();
    for (const flag of [
      '-c', '--convert',
      '-s', '--space',
      '--quote',
      '--quote-names',
      '--no-bigint-suffix',
      '--trailing-comma',
      '--legacy-escapes',
      '--non-finite',
      '--pure-json',
      '-o', '--out-file',
      '-v', '--validate',
      '-V', '--version',
      '-h', '--help',
    ]) {
      expect(help).toContain(flag);
    }
  });
});
