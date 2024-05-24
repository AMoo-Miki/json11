import { expect, describe, it, vi } from 'vitest';
import { parse } from '../src';

describe('parse(text)', () => {
  describe.concurrent('Objects', () => {
    it('parses empty objects', () => {
      expect(parse('{}')).toEqual({});
    });
    it('parses double string property names', () => {
      expect(parse('{"a":1}')).toEqual({ a: 1 });
    });
    it('parses single string property names', () => {
      expect(parse('{\'a\':1}')).toEqual({ a: 1 });
    });
    it('parses unquoted property names', () => {
      expect(parse('{a:1}')).toEqual({ a: 1 });
    });
    it('parses special character property names', () => {
      expect(parse('{$_:1,_$:2,a\u200C:3}')).toEqual({ $_: 1, _$: 2, 'a\u200C': 3 });
    });
    it('parses unicode property names', () => {
      expect(parse('{ùńîċõďë:9}')).toEqual({ 'ùńîċõďë': 9 });
    });
    it('parses escaped property names', () => {
      expect(parse('{\\u0061\\u0062:1,\\u0024\\u005F:2,\\u005F\\u0024:3}')).toEqual({ ab: 1, $_: 2, _$: 3 });
    });
    it('preserves __proto__ property names', () => {
      expect(parse('{"__proto__":1}').__proto__).toBe(1);
    });
    it('parses multiple properties', () => {
      expect(parse('{abc:1,def:2}')).toEqual({ abc: 1, def: 2 });
    });
    it('parses nested objects', () => {
      expect(parse('{a:{b:2}}')).toEqual({ a: { b: 2 } });
    });
  });

  describe.concurrent('Arrays', () => {
    it('parses empty arrays', () => {
      expect(parse('[]')).toEqual([]);
    });
    it('parses array values', () => {
      expect(parse('[1]')).toEqual([1]);
    });
    it('parses multiple array values', () => {
      expect(parse('[1,2]')).toEqual([1, 2]);
    });
    it('parses nested arrays', () => {
      expect(parse('[1,[2,3]]')).toEqual([1, [2, 3]]);
    });
  });

  describe.concurrent('Nulls', () => {
    it('parses nulls', () => {
      expect(parse('null')).toEqual(null);
    });
  });

  describe.concurrent('Booleans', () => {
    it('parses true', () => {
      expect(parse('true')).toEqual(true);
    });
    it('parses false', () => {
      expect(parse('false')).toEqual(false);
    });
  });

  describe.concurrent('Numbers', () => {
    it('parses 1', () => {
      expect(parse('1')).toEqual(1);
    });
    it('parses +1.23e100', () => {
      expect(parse('+1.23e100')).toEqual(1.23e100);
    });
    it('parses bare hexadecimal number', () => {
      expect(parse('0x1')).toEqual(0x1);
    });
    it('parses bare long hexadecimal number', () => {
      expect(parse('-0x0123456789abcdefABCDEF')).toEqual(-0x0123456789abcdefABCDEF);
    });
    it('parses leading zeroes', () => {
      expect(parse('[0,0.,0e0]')).toEqual([0, 0, 0]);
    });
    it('parses integers', () => {
      expect(parse('[1,23,456,7890]')).toEqual([1, 23, 456, 7890]);
    });
    it('parses signed numbers', () => {
      expect(parse('[-1,+2,-.1,-0]')).toEqual([-1, +2, -0.1, -0]);
    });
    it('parses leading decimal points', () => {
      expect(parse('[.1,.23]')).toEqual([0.1, 0.23]);
    });
    it('parses fractional numbers', () => {
      expect(parse('[1.0,1.23]')).toEqual([1, 1.23]);
    });
    it('parses exponents', () => {
      expect(parse('[1e0,1e1,1e01,1.e0,1.1e0,1e-1,1e+1]')).toEqual([1, 10, 10, 1, 1.1, 0.1, 10]);
    });
    it('parses hexadecimal numbers', () => {
      expect(parse('[0x1,0x10,0xff,0xFF]')).toEqual([1, 16, 255, 255]);
    });
    it('parses signed and unsigned Infinity', () => {
      expect(parse('[Infinity,-Infinity]')).toEqual([Infinity, -Infinity]);
    });
    it('parses NaN', () => {
      expect(isNaN(parse('NaN'))).toBe(true);
    });
    it('parses signed NaN', () => {
      expect(isNaN(parse('-NaN'))).toBe(true);
    });
  });

  describe.concurrent('Strings', () => {
    it('parses double quoted strings', () => {
      expect(parse('"abc"')).toBe('abc');
    });
    it('parses single quoted strings', () => {
      expect(parse('\'abc\'')).toBe('abc');
    });
    it('parses quotes in strings', () => {
      expect(parse(`['"',"'"]`)).toEqual(['"', '\'']);
    });
    it('parses quotes in strings', () => {
      expect(parse(`'\\b\\f\\n\\r\\t\\v\\0\\x0f\\u01fF\\\n\\\r\n\\\r\\\u2028\\\u2029\\a\\'\\"'`))
        .toBe(`\b\f\n\r\t\v\0\x0f\u01FF\a'"`);
    });
    it('parses quotes in strings', () => {
      const spy = vi.spyOn(console, 'warn')
        .mockImplementation(() => null);

      expect(parse('\'\u2028\u2029\'')).toBe('\u2028\u2029');

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenNthCalledWith(1, expect.stringContaining('not valid ECMAScript'));
      expect(spy).toHaveBeenNthCalledWith(2, expect.stringContaining('not valid ECMAScript'));

      spy.mockRestore();
    });
  });

  describe.concurrent('Comments', () => {
    it('parses single-line comments', () => {
      expect(parse('{//comment\n}')).toEqual({});
    });
    it('parses single-line comments at end of input', () => {
      expect(parse('{}//comment')).toEqual({});
    });
    it('parses multi-line comments', () => {
      expect(parse('{/*comment\n** */}')).toEqual({});
    });
  });

  describe.concurrent('Whitespaces', () => {
    it('parses whitespace', () => {
      expect(parse('{\t\v\f \u00A0\uFEFF\n\r\u2028\u2029\u2003}')).toEqual({});
    });
  });


  describe.concurrent('BigInt', () => {
    it('parses 1n', () => {
      expect(parse('1n')).toEqual(1n);
    });
    it('parses bare hexadecimal bigint', () => {
      expect(parse('0x1n')).toEqual(0x1n);
    });
    it('parses bare long hexadecimal number', () => {
      expect(parse('-0x0123456789abcdefABCDEFn')).toEqual(-0x0123456789abcdefABCDEFn);
    });
    it('parses bigint', () => {
      expect(parse('[1n]')).toEqual([1n]);
    });
    it('parses signed bigints', () => {
      expect(parse('[-1n,+2n,-0n]')).toEqual([-1n, 2n, 0n]);
    });
    it('parses hexadecimal bigints', () => {
      expect(parse('[0x1n,0x10n,0xffn,0xFFn]')).toEqual([1n, 16n, 255n, 255n]);
    });
  });
});

describe('parse(text, reviver)', () => {
  it('modifies property values', () => {
    expect(parse('{a:1,b:2}', (k, v) => (k === 'a') ? 'revived' : v))
      .toEqual({ a: 'revived', b: 2 });
  });
  it('modifies nested object property values', () => {
    expect(parse('{a:{b:2}}', (k, v) => (k === 'b') ? 'revived' : v))
      .toEqual({ a: { b: 'revived' } });
  });
  it('deletes property values', () => {
    expect(parse('{a:1,b:2}', (k, v) => (k === 'a') ? undefined : v))
      .toEqual({ b: 2 });
  });
  it('modifies array values', () => {
    expect(parse('[0,1,2]', (k, v) => (k === '1') ? 'revived' : v))
      .toEqual([0, 'revived', 2]);
  });
  it('modifies nested array values', () => {
    expect(parse('[0,[1,2,3]]', (k, v) => (k === '2') ? 'revived' : v))
      .toEqual([0, [1, 2, 'revived']]);
  });
  it('deletes array values', () => {
    expect(parse('[0,1,2]', (k, v) => (k === '1') ? undefined : v))
      .toEqual([0, undefined, 2]);
  });
  it('modifies the root value', () => {
    expect(parse('1', (k, v) => (k === '') ? 'revived' : v))
      .toBe('revived');
  });
  it('sets `this` to the parent value', () => {
    expect(parse('{a:{b:2}}', function (k, v) {
      return (k === 'b' && this.b) ? 'revived' : v
    }))
      .toEqual({ a: { b: 'revived' } });
  });
});

describe('parse(text, null, options)', () => {
  describe('withLongNumerals', () => {
    const bigNumeral = 3n * BigInt(Number.MAX_SAFE_INTEGER);
    // Some long numerals don't lose value without precision
    const longNumeral1 = bigNumeral.toString();
    const longNumeral2 = (1n + bigNumeral).toString();
    const longNumeral3 = (2n + bigNumeral).toString();
    const longNumeral4 = (3n + bigNumeral).toString();

    it('parses long numerals without precision when withLongNumerals is unset', () => {
      expect(parse(`[${longNumeral1},${longNumeral2},${longNumeral3},${longNumeral4}]`))
        .toEqual([
          Number(longNumeral1),
          Number(longNumeral2),
          Number(longNumeral3),
          Number(longNumeral4),
        ]);
    });

    it('parses long numerals without precision when withLongNumerals is false', () => {
      expect(parse(
        `[${longNumeral1},${longNumeral2},${longNumeral3},${longNumeral4}]`,
        null,
        { withLongNumerals: false }
      ))
        .toEqual([
          Number(longNumeral1),
          Number(longNumeral2),
          Number(longNumeral3),
          Number(longNumeral4),
        ]);
    });

    it('parses long numerals as BigInts when withLongNumerals is true', () => {
      expect(parse(
        `[${longNumeral1},${longNumeral2},${longNumeral3},${longNumeral4}]`,
        null,
        { withLongNumerals: true }
      ))
        .toEqual([
          bigNumeral,
          1n + bigNumeral,
          2n + bigNumeral,
          3n + bigNumeral,
        ]);
    });
  });
});

describe('parse errors', () => {
  it('throws on empty documents', () => {
    expect(() => parse('')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:1]`);
  });

  it('throws on documents with only comments', () => {
    expect(() => parse('//a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:4]`);
  });

  it('throws on incomplete single line comments', () => {
    expect(() => parse('/a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:2]`);
  });

  it('throws on unterminated multiline comments', () => {
    expect(() => parse('/*')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:3]`);
  });

  it('throws on unterminated multiline comment closings', () => {
    expect(() => parse('/**')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:4]`);
  });

  it('throws on invalid characters in values', () => {
    expect(() => parse('a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:1]`);
  });

  it('throws on invalid characters in identifier start escapes', () => {
    expect(() => parse('{\\a:1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:3]`);
  });

  it('throws on invalid identifier start characters', () => {
    expect(() => parse('{\\u0021:1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid identifier character at 1:2]`);
  });

  it('throws on invalid characters in identifier continue escapes', () => {
    expect(() => parse('{a\\a:1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:4]`);
  });

  it('throws on invalid identifier continue characters', () => {
    expect(() => parse('{a\\u0021:1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid identifier character at 1:3]`);
  });

  it('throws on invalid characters following a sign', () => {
    expect(() => parse('-a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:2]`);
  });

  it('throws on invalid characters following a leading decimal point', () => {
    expect(() => parse('.a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:2]`);
  });

  it('throws on invalid characters following an exponent indicator', () => {
    expect(() => parse('1ea')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:3]`);
  });

  it('throws on invalid characters following an exponent sign', () => {
    expect(() => parse('1e-a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'a' at 1:4]`);
  });

  it('throws on invalid characters following a hexadecimal indicator', () => {
    expect(() => parse('0xg')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'g' at 1:3]`);
  });

  it('throws on invalid new lines in strings', () => {
    expect(() => parse('"\n"')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '\\n' at 2:0]`);
  });

  it('throws on unterminated strings', () => {
    expect(() => parse('"')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:2]`);
  });

  it('throws on invalid identifier start characters in property names', () => {
    expect(() => parse('{!:1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '!' at 1:2]`);
  });

  it('throws on invalid characters following a property name', () => {
    expect(() => parse('{a!1}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '!' at 1:3]`);
  });

  it('throws on invalid characters following a property value', () => {
    expect(() => parse('{a:1!}')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '!' at 1:5]`);
  });

  it('throws on invalid characters following an array value', () => {
    expect(() => parse('[1!]')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '!' at 1:3]`);
  });

  it('throws on invalid characters in literals', () => {
    expect(() => parse('tru!')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '!' at 1:4]`);
  });

  it('throws on unterminated escapes', () => {
    expect(() => parse('"\\')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:3]`);
  });

  it('throws on invalid first digits in hexadecimal escapes', () => {
    expect(() => parse('"\\xg"')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'g' at 1:4]`);
  });

  it('throws on invalid second digits in hexadecimal escapes', () => {
    expect(() => parse('"\\x0g"')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'g' at 1:5]`);
  });

  it('throws on invalid unicode escapes', () => {
    expect(() => parse('"\\u000g"')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character 'g' at 1:7]`);
  });

  for (let i = 1; i <= 9; i++) {
    it(`throws on escaped digit ${i}`, () => {
      expect(() => parse(`'\\${i}'`)).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '${i}' at 1:3]`);
    });
  }

  it('throws on octal escapes', () => {
    expect(() => parse("'\\01'")).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '1' at 1:4]`);
  });

  it('throws on multiple values', () => {
    expect(() => parse('1 2')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '2' at 1:3]`);
  });

  it('throws with control characters escaped in the message', () => {
    expect(() => parse('\x01')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid character '\\x01' at 1:1]`);
  });

  it('throws on unclosed objects before property names', () => {
    expect(() => parse('{')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:2]`);
  });

  it('throws on unclosed objects after property names', () => {
    expect(() => parse('{a')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:3]`);
  });

  it('throws on unclosed objects before property values', () => {
    expect(() => parse('{a:')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:4]`);
  });

  it('throws on unclosed objects after property values', () => {
    expect(() => parse('{a:1')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:5]`);
  });

  it('throws on unclosed arrays before values', () => {
    expect(() => parse('[')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:2]`);
  });

  it('throws on unclosed arrays after values', () => {
    expect(() => parse('[1')).toThrowErrorMatchingInlineSnapshot(`[SyntaxError: JSON11: invalid end of input at 1:3]`);
  });
});
