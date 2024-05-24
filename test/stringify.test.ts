import { expect, describe, it } from 'vitest';
import { stringify } from '../src';

describe('stringify(value)', () => {
  describe.concurrent('Objects', () => {
    it('stringifies empty objects', () => {
      expect(stringify({})).toBe('{}');
    });

    it('stringifies unquoted property names', () => {
      expect(stringify({ a: 1 })).toBe('{a:1}');
    });

    it('stringifies property names with special chars in quotes', () => {
      expect(stringify({ 'a-b': 1 })).toBe('{\'a-b\':1}');
    });

    it('stringifies single quoted string property names', () => {
      expect(stringify({ 'a\'': 1 })).toBe(`{"a'":1}`);
    });

    it('stringifies double quoted string property names', () => {
      expect(stringify({ "a\"": 1 })).toBe(`{'a"':1}`);
    });

    it('stringifies empty string property names', () => {
      expect(stringify({ '': 1 })).toBe('{\'\':1}');
    });

    it('stringifies special character property names', () => {
      expect(stringify({ $_: 1, _$: 2, 'a\u200C': 3 })).toBe('{$_:1,_$:2,a\u200C:3}');
    });

    it('stringifies unicode property names', () => {
      expect(stringify({ 'ùńîċõďë': 9 })).toBe('{ùńîċõďë:9}');
    });

    it('stringifies escaped property names', () => {
      expect(stringify({ '\\\b\f\n\r\t\v\0\x01': 1 })).toBe('{\'\\\\\\b\\f\\n\\r\\t\\v\\0\\x01\':1}');
    });

    it('stringifies escaped null character property names', () => {
      expect(stringify({ '\0\x001': 1 })).toBe('{\'\\0\\x001\':1}');
    });

    it('stringifies multiple properties', () => {
      expect(stringify({ abc: 1, def: 2 })).toBe('{abc:1,def:2}');
    });

    it('stringifies nested objects', () => {
      expect(stringify({ a: { b: 2 } })).toBe('{a:{b:2}}');
    });
  });

  describe.concurrent('Arrays', () => {
    it('stringifies empty arrays', () => {
      expect(stringify([])).toBe('[]');
    });

    it('stringifies array values', () => {
      expect(stringify([1])).toBe('[1]');
    });

    it('stringifies multiple array values', () => {
      expect(stringify([1, 2])).toBe('[1,2]');
    });

    it('stringifies nested arrays', () => {
      expect(stringify([1, [2, 3]])).toBe('[1,[2,3]]');
    });
  });

  describe.concurrent('Nulls', () => {
    it('stringifies nulls', () => {
      expect(stringify(null)).toBe('null');
    });
  });

  describe.concurrent('Functions', () => {
    it('returns undefined for functions', () => {
      expect(stringify(() => {})).toBeUndefined();
    });

    it('ignores function properties', () => {
      expect(stringify({
        a() {}
      })).toBe('{}');
    });

    it('returns null for functions in arrays', () => {
      expect(stringify([() => {
      }])).toBe('[null]');
    });
  });

  describe.concurrent('Booleans', () => {
    it('stringifies true', () => {
      expect(stringify(true)).toBe('true');
    });

    it('stringifies false', () => {
      expect(stringify(false)).toBe('false');
    });

    it('stringifies true Boolean objects', () => {
      expect(stringify(new Boolean(true))).toBe('true');
    });

    it('stringifies false Boolean objects', () => {
      expect(stringify(new Boolean(false))).toBe('false');
    });
  });

  describe.concurrent('Numbers', () => {
    it('stringifies numbers', () => {
      expect(stringify(-1.2)).toBe('-1.2');
    });

    it('stringifies non-finite numbers', () => {
      expect(stringify([Infinity, -Infinity, NaN])).toBe('[Infinity,-Infinity,NaN]');
    });

    it('stringifies Number objects', () => {
      expect(stringify(new Number(-1.2))).toBe('-1.2');
    });
  });

  describe.concurrent('BigInts', () => {
    it('stringifies bigints', () => {
      expect(stringify(-12n)).toBe('-12n');
    });

    it('stringifies bigints in arrays', () => {
      expect(stringify([-12n, 13n, 0n])).toBe('[-12n,13n,0n]');
    });
  });

  describe.concurrent('Strings', () => {
    it('stringifies single quoted strings', () => {
      expect(stringify('abc')).toBe('\'abc\'');
    });

    it('stringifies double quoted strings', () => {
      expect(stringify('abc\'')).toBe(`"abc'"`);
    });

    it('stringifies escaped characters', () => {
      expect(stringify('\\\b\f\n\r\t\v\0\x0f')).toBe('\'\\\\\\b\\f\\n\\r\\t\\v\\0\\x0f\'');
    });

    it('stringifies escaped null characters', () => {
      expect(stringify('\0\x001')).toBe('\'\\0\\x001\'');
    });

    it('stringifies escaped single quotes', () => {
      expect(stringify(`'"`)).toBe(`'\\'"'`);
    });

    it('stringifies escaped double quotes', () => {
      expect(stringify(`''"`)).toBe(`"''\\""`);
    });

    it('stringifies escaped line and paragraph separators', () => {
      expect(stringify('\u2028\u2029')).toBe('\'\\u2028\\u2029\'');
    });

    it('stringifies String objects', () => {
      expect(stringify(new String('abc'))).toBe('\'abc\'');
    });
  });

  describe.concurrent('toJSON', () => {
    it('stringifies using built-in toJSON methods', () => {
      expect(stringify(new Date('2016-01-01T00:00:00.000Z'))).toBe(`'2016-01-01T00:00:00.000Z'`);
    });

    it('stringifies using user defined toJSON methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON() {
          return { a: 1, b: 2 }
        }
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON(key) methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON(key: any) {
          return (key === 'a') ? 1 : 2
        }
      });

      // @ts-ignore
      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON methods', () => {
      class C {
        toJSON() {
          return { a: 1, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON(key) methods', () => {
      class C {
        toJSON(key: any) {
          return (key === 'a') ? 1 : 2
        }
      }

      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON5 methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON5() {
          return { a: 1, b: 2 }
        }
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON5(key) methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON5(key: any) {
          return (key === 'a') ? 1 : 2
        }
      });

      // @ts-ignore
      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON5 methods', () => {
      class C {
        toJSON5() {
          return { a: 1, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON5(key) methods', () => {
      class C {
        toJSON5(key: any) {
          return (key === 'a') ? 1 : 2
        }
      }

      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON11 methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON11() {
          return { a: 1, b: 2 }
        }
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON11(key) methods', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON11(key: any) {
          return (key === 'a') ? 1 : 2
        }
      });

      // @ts-ignore
      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON11 methods', () => {
      class C {
        toJSON11() {
          return { a: 1, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:1,b:2}');
    });

    it('stringifies using class defined toJSON11(key) methods', () => {
      class C {
        toJSON11(key: any) {
          return (key === 'a') ? 1 : 2
        }
      }

      expect(stringify({ a: new C(), b: new C() })).toBe('{a:1,b:2}');
    });

    it('stringifies using user defined toJSON11 methods over toJSON', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON() {
          return { a: 1, b: 2 }
        },
        toJSON11() {
          return { a: 2, b: 2 }
        },
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:2,b:2}');
    });

    it('stringifies using user defined toJSON11 methods over toJSON5', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON5() {
          return { a: 1, b: 2 }
        },
        toJSON11() {
          return { a: 2, b: 2 }
        },
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:2,b:2}');
    });

    it('stringifies using user defined toJSON5 methods over toJSON', () => {
      function C() {}
      Object.assign(C.prototype, {
        toJSON() {
          return { a: 1, b: 2 }
        },
        toJSON5() {
          return { a: 2, b: 2 }
        },
      });

      // @ts-ignore
      expect(stringify(new C())).toBe('{a:2,b:2}');
    });

    it('stringifies using class defined toJSON11 methods over toJSON', () => {
      class C {
        toJSON() {
          return { a: 1, b: 2 }
        }
        toJSON11() {
          return { a: 2, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:2,b:2}');
    });

    it('stringifies using class defined toJSON11 methods over toJSON5', () => {
      class C {
        toJSON5() {
          return { a: 1, b: 2 }
        }
        toJSON11() {
          return { a: 2, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:2,b:2}');
    });

    it('stringifies using class defined toJSON5 methods over toJSON', () => {
      class C {
        toJSON() {
          return { a: 1, b: 2 }
        }
        toJSON5() {
          return { a: 2, b: 2 }
        }
      }

      expect(stringify(new C())).toBe('{a:2,b:2}');
    });
  });
});

describe('stringify(value, options)', () => {
  describe.concurrent('withBigInt', () => {
    const bigNumeral = -3n * BigInt(Number.MAX_SAFE_INTEGER);
    const longNumeral = bigNumeral.toString();

    it('stringifies bigints with the n-suffix when withBigInt is unset', () => {
      expect(stringify({ a: bigNumeral }, {})).toBe(`{a:${longNumeral}n}`);
    });

    it('stringifies bigints with the n-suffix when withBigInt is true', () => {
      expect(stringify({ a: bigNumeral }, { withBigInt: true })).toBe(`{a:${longNumeral}n}`);
    });

    it('stringifies bigints with the n-suffix when withBigInt is false', () => {
      expect(stringify({ a: bigNumeral }, { withBigInt: false })).toBe(`{a:${longNumeral}}`);
    });
  });

  describe.concurrent('quote', () => {
    describe.concurrent('Objects', () => {
      it('stringifies unquoted property names', () => {
        expect(stringify({ a: 1 }, { quote: '"' })).toBe('{a:1}');
      });

      it('stringifies property names with special chars in quotes', () => {
        expect(stringify({ 'a-b': 1 }, { quote: '"' })).toBe('{"a-b":1}');
      });

      it('stringifies single quoted string property names', () => {
        expect(stringify({ 'a\'': 1 }, { quote: '"' })).toBe(`{"a'":1}`);
      });

      it('stringifies double quoted string property names', () => {
        expect(stringify({ "a\"": 1 }, { quote: '"' })).toBe(`{"a\\"":1}`);
      });

      it('stringifies empty string property names', () => {
        expect(stringify({ '': 1 }, { quote: '"' })).toBe('{"":1}');
      });

      it('stringifies special character property names', () => {
        expect(stringify({ $_: 1, _$: 2, 'a\u200C': 3 }, { quote: '"' })).toBe('{$_:1,_$:2,a\u200C:3}');
      });

      it('stringifies unicode property names', () => {
        expect(stringify({ 'ùńîċõďë': 9 }, { quote: '"' })).toBe('{ùńîċõďë:9}');
      });

      it('stringifies escaped property names', () => {
        expect(stringify({ '\\\b\f\n\r\t\v\0\x01': 1 }, { quote: '"' })).toBe('{"\\\\\\b\\f\\n\\r\\t\\v\\0\\x01":1}');
      });

      it('stringifies escaped null character property names', () => {
        expect(stringify({ '\0\x001': 1 }, { quote: '"' })).toBe('{"\\0\\x001":1}');
      });

      it('stringifies multiple properties', () => {
        expect(stringify({ abc: 1, def: 2 }, { quote: '"' })).toBe('{abc:1,def:2}');
      });

      it('stringifies nested objects', () => {
        expect(stringify({ a: { b: 2 } }, { quote: '"' })).toBe('{a:{b:2}}');
      });
    });

    describe.concurrent('Arrays', () => {
      it('stringifies nested arrays', () => {
        expect(stringify([1, [2, 3], 'a', 'b'], { quote: '"' })).toBe('[1,[2,3],"a","b"]');
      });
    });

    describe.concurrent('Booleans', () => {
      it('stringifies true', () => {
        expect(stringify(true, { quote: '"' })).toBe('true');
      });

      it('stringifies false', () => {
        expect(stringify(false, { quote: '"' })).toBe('false');
      });
    });

    describe.concurrent('Strings', () => {
      it('stringifies single quotes in strings', () => {
        expect(stringify("abc'", { quote: '"' })).toBe(`"abc'"`);
      });

      it('stringifies double quotes in strings', () => {
        expect(stringify('abc"', { quote: '"' })).toBe(`"abc\\""`);
      });

      it('stringifies escaped characters', () => {
        expect(stringify('\\\b\f\n\r\t\v\0\x0f', { quote: '"' })).toBe('"\\\\\\b\\f\\n\\r\\t\\v\\0\\x0f"');
      });

      it('stringifies escaped null characters', () => {
        expect(stringify('\0\x001', { quote: '"' })).toBe('"\\0\\x001"');
      });

      it('stringifies escaped single quotes', () => {
        expect(stringify(`'"`, { quote: '"' })).toBe(`"'\\""`);
      });

      it('stringifies escaped double quotes', () => {
        expect(stringify(`''"`, { quote: '"' })).toBe(`"''\\""`);
      });

      it('stringifies escaped line and paragraph separators', () => {
        expect(stringify('\u2028\u2029', { quote: '"' })).toBe('"\\u2028\\u2029"');
      });

      it('stringifies String objects', () => {
        expect(stringify(new String('abc'), { quote: '"' })).toBe('"abc"');
      });
    });

  });

  describe.concurrent('quoteNames', () => {
    describe.concurrent('Objects', () => {
      it('stringifies unquoted property names', () => {
        expect(stringify({ a: 1 }, { quote: '"', quoteNames: true })).toBe('{"a":1}');
      });

      it('stringifies empty string property names', () => {
        expect(stringify({ '': 1 }, { quote: '"', quoteNames: true })).toBe('{"":1}');
      });

      it('stringifies special character property names', () => {
        expect(stringify({ $_: 1, _$: 2, 'a\u200C': 3 }, { quote: '"', quoteNames: true })).toBe('{"$_":1,"_$":2,"a\u200C":3}');
      });

      it('stringifies unicode property names', () => {
        expect(stringify({ 'ùńîċõďë': 9 }, { quote: '"', quoteNames: true })).toBe('{"ùńîċõďë":9}');
      });

      it('stringifies multiple properties', () => {
        expect(stringify({ abc: 1, def: 2 }, { quote: '"', quoteNames: true })).toBe('{"abc":1,"def":2}');
      });

      it('stringifies nested objects', () => {
        expect(stringify({ a: { b: 2 } }, { quote: '"', quoteNames: true })).toBe('{"a":{"b":2}}');
      });
    });
  });
});

describe('stringify(value, null, null, options)', () => {
  describe.concurrent('withBigInt', () => {
    const bigNumeral = -3n * BigInt(Number.MAX_SAFE_INTEGER);
    const longNumeral = bigNumeral.toString();

    it('stringifies bigints with the n-suffix when withBigInt is unset', () => {
      expect(stringify({ a: bigNumeral }, null, null, {})).toBe(`{a:${longNumeral}n}`);
    });

    it('stringifies bigints with the n-suffix when withBigInt is true', () => {
      expect(stringify({ a: bigNumeral }, null, null, { withBigInt: true })).toBe(`{a:${longNumeral}n}`);
    });

    it('stringifies bigints with the n-suffix when withBigInt is false', () => {
      expect(stringify({ a: bigNumeral }, null, null, { withBigInt: false })).toBe(`{a:${longNumeral}}`);
    });
  });
});

describe('parse errors', () => {
  it('throws on circular objects', () => {
    let a = {};
    // @ts-ignore
    a.a = a;
    expect(() => stringify(a)).toThrowError('Converting circular structure to JSON11');
  });

  it('throws on circular arrays', () => {
    let a: any = [];
    a[0] = a;
    expect(() => stringify(a)).toThrowError('Converting circular structure to JSON11');
  });
});
