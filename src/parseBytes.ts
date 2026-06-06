/* Internal byte-input parser for JSON11 byte-mode.
 *
 * This is a faithful port of the string parser's state machine (`./parse`) onto
 * a Uint8Array source: the lexer/parser states are identical so the byte path
 * accepts exactly the same JSON11 grammar, but it reads UTF-8 bytes (with strict
 * bounds checks) instead of a JS String and can return string *values* as
 * borrowed `RawString` spans instead of materializing them on the heap.
 *
 * It is not a public export; it is reached through `parse(bytes, …, { raw })`.
 */

import * as util from './util';
import { decodeUtf8 } from './bytes';
import { byteError, QuoteByte, RawString, scanStringForParse } from './raw';

export type RawMode = 'off' | 'values' | 'all';

export type ParseBytesOptions = {
  withLongNumerals?: boolean;
  raw?: RawMode;
  /* Maximum digit-buffer length accepted for a BigInt literal (the explicit
   * `…n` form and the withLongNumerals promotion). Defaults to
   * util.MAX_NUMERIC_DIGITS_DEFAULT; bounds the super-linear BigInt(...) cost. */
  maxNumericDigits?: number;
  /* Maximum nesting depth the reviver walk will descend before throwing. Only
   * the reviver path recurses (tree construction is iterative), so this bounds
   * the reviver's stack use. Defaults to util.MAX_DEPTH_DEFAULT. */
  maxDepth?: number;
};

export function parseBytes<T = any>(
  source: Uint8Array,
  reviver?: ((this: any, key: string, value: any) => any) | null,
  options?: ParseBytesOptions,
): T {
  const rawValues = options?.raw === 'values' || options?.raw === 'all';
  const maxNumericDigits = options?.maxNumericDigits ?? util.MAX_NUMERIC_DIGITS_DEFAULT;
  const maxDepth = options?.maxDepth ?? util.MAX_DEPTH_DEFAULT;

  let parseState: string = 'start';
  let stack: any[] = [];
  let pos: number = 0;
  let line: number = 1;
  let column: number = 0;
  let token: any;
  let key: any;
  let root: any;
  let lexState: string;
  let buffer: string | undefined;
  let sign: number;
  let c: string | undefined;

  const lexStates: { [key: string]: () => any } = {
    default() {
      switch (c) {
        case '\t':
        case '\v':
        case '\f':
        case ' ':
        case '\u00A0':
        case '\uFEFF':
        case '\n':
        case '\r':
        case '\u2028':
        case '\u2029':
          read();
          return;

        case '/':
          read();
          lexState = 'comment';
          return;

        case undefined:
          read();
          return newToken('eof');
      }

      if (util.isSpaceSeparator(c)) {
        read();
        return;
      }

      return lexStates[parseState]();
    },

    comment() {
      switch (c) {
        case '*':
          read();
          lexState = 'multiLineComment';
          return;

        case '/':
          read();
          lexState = 'singleLineComment';
          return;
      }

      throw invalidChar(read());
    },

    multiLineComment() {
      switch (c) {
        case '*':
          read();
          lexState = 'multiLineCommentAsterisk';
          return;

        case undefined:
          throw invalidChar(read());
      }

      read();
    },

    multiLineCommentAsterisk() {
      switch (c) {
        case '*':
          read();
          return;

        case '/':
          read();
          lexState = 'default';
          return;

        case undefined:
          throw invalidChar(read());
      }

      read();
      lexState = 'multiLineComment';
    },

    singleLineComment() {
      switch (c) {
        case '\n':
        case '\r':
        case '\u2028':
        case '\u2029':
          read();
          lexState = 'default';
          return;

        case undefined:
          read();
          return newToken('eof');
      }

      read();
    },

    value() {
      switch (c) {
        case '{':
        case '[':
          return newToken('punctuator', read());

        case 'n':
          read();
          literal('ull');
          return newToken('null', null);

        case 't':
          read();
          literal('rue');
          return newToken('boolean', true);

        case 'f':
          read();
          literal('alse');
          return newToken('boolean', false);

        case '-':
        case '+':
          if (read() === '-') {
            sign = -1;
          }

          lexState = 'sign';
          return;

        case '.':
          buffer = read();
          lexState = 'decimalPointLeading';
          return;

        case '0':
          buffer = read();
          lexState = 'zero';
          return;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          buffer = read();
          lexState = 'decimalInteger';
          return;

        case 'I':
          read();
          literal('nfinity');
          return newToken('numeric', Infinity);

        case 'N':
          read();
          literal('aN');
          return newToken('numeric', NaN);

        case '"':
        case '\'':
          return scanStringToken(c === '"' ? 0x22 : 0x27, !rawValues);
      }

      throw invalidChar(read());
    },

    identifierNameStartEscape() {
      if (c !== 'u') {
        throw invalidChar(read());
      }

      read();
      const u = unicodeEscape();
      switch (u) {
        case '$':
        case '_':
          break;

        default:
          if (!util.isIdStartChar(u)) {
            throw invalidIdentifier();
          }

          break;
      }

      buffer += u;
      lexState = 'identifierName';
    },

    identifierName() {
      switch (c) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
          buffer += read()!;
          return;

        case '\\':
          read();
          lexState = 'identifierNameEscape';
          return;
      }

      if (util.isIdContinueChar(c)) {
        buffer += read()!;
        return;
      }

      return newToken('identifier', buffer);
    },

    identifierNameEscape() {
      if (c !== 'u') {
        throw invalidChar(read());
      }

      read();
      const u = unicodeEscape();
      switch (u) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
          break;

        default:
          if (!util.isIdContinueChar(u)) {
            throw invalidIdentifier();
          }

          break;
      }

      buffer += u;
      lexState = 'identifierName';
    },

    sign() {
      switch (c) {
        case '.':
          buffer = read();
          lexState = 'decimalPointLeading';
          return;

        case '0':
          buffer = read();
          lexState = 'zero';
          return;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          buffer = read();
          lexState = 'decimalInteger';
          return;

        case 'I':
          read();
          literal('nfinity');
          return newToken('numeric', sign * Infinity);

        case 'N':
          read();
          literal('aN');
          return newToken('numeric', NaN);
      }

      throw invalidChar(read());
    },

    zero() {
      switch (c) {
        case '.':
          buffer += read()!;
          lexState = 'decimalPoint';
          return;

        case 'e':
        case 'E':
          buffer += read()!;
          lexState = 'decimalExponent';
          return;

        case 'x':
        case 'X':
          buffer += read()!;
          lexState = 'hexadecimal';
          return;

        case 'n':
          lexState = 'bigInt';
          return;
      }

      return newToken('numeric', sign * 0);
    },

    decimalInteger() {
      switch (c) {
        case '.':
          buffer += read()!;
          lexState = 'decimalPoint';
          return;

        case 'e':
        case 'E':
          buffer += read()!;
          lexState = 'decimalExponent';
          return;

        case 'n':
          lexState = 'bigInt';
          return;

      }

      if (util.isDigit(c)) {
        buffer += read()!;
        return;
      }

      return newNumericToken(sign, buffer);
    },

    decimalPointLeading() {
      if (util.isDigit(c)) {
        buffer += read()!;
        lexState = 'decimalFraction';
        return;
      }

      throw invalidChar(read());
    },

    decimalPoint() {
      switch (c) {
        case 'e':
        case 'E':
          buffer += read()!;
          lexState = 'decimalExponent';
          return;
      }

      if (util.isDigit(c)) {
        buffer += read()!;
        lexState = 'decimalFraction';
        return;
      }

      return newNumericToken(sign, buffer);
    },

    decimalFraction() {
      switch (c) {
        case 'e':
        case 'E':
          buffer += read()!;
          lexState = 'decimalExponent';
          return;
      }

      if (util.isDigit(c)) {
        buffer += read()!;
        return;
      }

      return newNumericToken(sign, buffer);
    },

    decimalExponent() {
      switch (c) {
        case '+':
        case '-':
          buffer += read()!;
          lexState = 'decimalExponentSign';
          return;
      }

      if (util.isDigit(c)) {
        buffer += read()!;
        lexState = 'decimalExponentInteger';
        return;
      }

      throw invalidChar(read());
    },

    decimalExponentSign() {
      if (util.isDigit(c)) {
        buffer += read()!;
        lexState = 'decimalExponentInteger';
        return;
      }

      throw invalidChar(read());
    },

    decimalExponentInteger() {
      if (util.isDigit(c)) {
        buffer += read()!;
        return;
      }

      return newNumericToken(sign, buffer);
    },

    bigInt() {
      if (buffer?.length && (util.isInteger(buffer) || util.isHex(buffer))) {
        if (buffer.length > maxNumericDigits) {
          throw byteError(
            `numeric literal of length ${buffer.length} exceeds the ${maxNumericDigits}-digit BigInt cap`,
            pos,
          );
        }
        read();
        return newToken('bigint', BigInt(sign) * BigInt(buffer));
      }

      throw invalidChar(read());
    },

    hexadecimal() {
      if (util.isHexDigit(c)) {
        buffer += read()!;
        lexState = 'hexadecimalInteger';
        return;
      }

      throw invalidChar(read());
    },

    hexadecimalInteger() {
      if (util.isHexDigit(c)) {
        buffer += read()!;
        return;
      }

      if (c === 'n') {
        lexState = 'bigInt';
        return;
      }

      return newNumericToken(sign, buffer);
    },

    start() {
      switch (c) {
        case '{':
        case '[':
          return newToken('punctuator', read());

        case undefined:
          return newToken('eof')
      }

      lexState = 'value';
    },

    beforePropertyName() {
      switch (c) {
        case '$':
        case '_':
          buffer = read();
          lexState = 'identifierName';
          return;

        case '\\':
          read();
          lexState = 'identifierNameStartEscape';
          return;

        case '}':
          return newToken('punctuator', read());

        case '"':
        case '\'':
          return scanStringToken(c === '"' ? 0x22 : 0x27, true);
      }

      if (util.isIdStartChar(c)) {
        buffer += read()!;
        lexState = 'identifierName';
        return;
      }

      throw invalidChar(read());
    },

    afterPropertyName() {
      if (c === ':') {
        return newToken('punctuator', read());
      }

      throw invalidChar(read());
    },

    beforePropertyValue() {
      lexState = 'value';
    },

    afterPropertyValue() {
      switch (c) {
        case ',':
        case '}':
          return newToken('punctuator', read());
      }

      throw invalidChar(read());
    },

    beforeArrayValue() {
      if (c === ']') {
        return newToken('punctuator', read());
      }

      lexState = 'value';
    },

    afterArrayValue() {
      switch (c) {
        case ',':
        case ']':
          return newToken('punctuator', read());
      }

      throw invalidChar(read());
    },

    end() {
      throw invalidChar(read());
    },
  };

  const parseStates: { [key: string]: () => void } = {
    start() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      push();
    },

    beforePropertyName() {
      switch (token.type) {
        case 'identifier':
        case 'string':
          key = token.value;
          parseState = 'afterPropertyName';
          return;

        case 'punctuator':
          pop();
          return;

        case 'eof':
          throw invalidEOF();
      }
    },

    afterPropertyName() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      parseState = 'beforePropertyValue';
    },

    beforePropertyValue() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      push();
    },

    beforeArrayValue() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      if (token.type === 'punctuator' && token.value === ']') {
        pop();
        return;
      }

      push();
    },

    afterPropertyValue() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      switch (token.value) {
        case ',':
          parseState = 'beforePropertyName';
          return;

        case '}':
          pop();
      }
    },

    afterArrayValue() {
      if (token.type === 'eof') {
        throw invalidEOF();
      }

      switch (token.value) {
        case ',':
          parseState = 'beforeArrayValue';
          return;

        case ']':
          pop();
      }
    },

    end() {
      // Do nothing
    },
  };

  do {
    token = lex();

    parseStates[parseState]();
  } while (token.type !== 'eof');

  if (typeof reviver === 'function') {
    return internalize({ '': root }, '', reviver, 0);
  }

  return root;

  function internalize(holder: any, name: string, reviver: (key: string, value: any) => any, depth: number): any {
    if (depth > maxDepth) {
      throw byteError(`maximum nesting depth ${maxDepth} exceeded`, pos);
    }
    const value = holder[name];
    if (value != null && typeof value === 'object' && !(value instanceof RawString)) {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const key = String(i);
          const replacement = internalize(value, key, reviver, depth + 1);
          Object.defineProperty(value, key, {
            value: replacement,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      } else {
        for (const key in value) {
          const replacement = internalize(value, key, reviver, depth + 1);
          if (replacement === undefined) {
            delete value[key];
          } else {
            Object.defineProperty(value, key, {
              value: replacement,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
        }
      }
    }

    return reviver.call(holder, name, value);
  }

  function lex(): any {
    lexState = 'default';
    buffer = '';
    sign = 1;

    for (; ;) {
      c = peek();

      const token = lexStates[lexState]();
      if (token) {
        return token;
      }
    }
  }

  function peek(): string | undefined {
    if (pos >= source.length) {
      return undefined;
    }
    let dec;
    try {
      dec = decodeUtf8(source, pos);
    } catch (ex) {
      throw byteError((ex as Error).message, pos);
    }
    if (!dec) {
      return undefined;
    }
    return String.fromCodePoint(dec.cp);
  }

  function read(): string | undefined {
    if (pos >= source.length) {
      column++;
      return undefined;
    }
    let dec;
    try {
      dec = decodeUtf8(source, pos);
    } catch (ex) {
      throw byteError((ex as Error).message, pos);
    }
    if (!dec) {
      column++;
      return undefined;
    }

    const cp = dec.cp;
    if (cp === 0x0a) {
      line++;
      column = 0;
    } else {
      column++;
    }
    pos += dec.size;
    return String.fromCodePoint(cp);
  }

  /* Consume an opening quote (already the current char), then scan the whole
   * string value/key via the shared escape engine. Advances `pos` past the
   * closing quote and returns the token. */
  function scanStringToken(quoteByte: number, collect: boolean): any {
    read(); // consume opening quote
    const startInner = pos;
    const res = scanStringForParse(source, pos, quoteByte, collect, separatorWarn);
    pos = res.innerEnd + 1;
    column += res.innerEnd - startInner + 1;

    if (collect) {
      return newToken('string', res.value);
    }
    return newToken('string', new RawString(source, startInner, res.innerEnd, quoteByte as QuoteByte));
  }

  function newToken(type: string, value?: any): any {
    return {
      type,
      value,
      line,
      column,
    };
  }

  function newNumericToken(sign: number, buffer?: string): any {
    const num = sign * Number(buffer);

    if (options?.withLongNumerals) {
      if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
        if (buffer!.length > maxNumericDigits) {
          throw byteError(
            `numeric literal of length ${buffer!.length} exceeds the ${maxNumericDigits}-digit BigInt cap`,
            pos,
          );
        }
        try {
          return newToken('bigint', BigInt(sign) * BigInt(buffer!));
        } catch (ex) {
          // RangeError when num is not an integer
          console.warn(ex);
        }
      }
    }

    return newToken('numeric', num);
  }

  function literal(s: string): void {
    for (const ch of s) {
      const p = peek();

      if (p !== ch) {
        throw invalidChar(read());
      }

      read();
    }
  }

  function unicodeEscape(): string {
    let buffer = '';
    let count = 4;

    while (count-- > 0) {
      const ch = peek();
      if (!util.isHexDigit(ch)) {
        throw invalidChar(read());
      }

      buffer += read()!;
    }

    return String.fromCodePoint(parseInt(buffer, 16));
  }

  function push() {
    let value;

    switch (token.type) {
      case 'punctuator':
        switch (token.value) {
          case '{':
            value = {};
            break;

          case '[':
            value = [];
            break;
        }

        break;

      case 'null':
      case 'boolean':
      case 'numeric':
      case 'string':
      case 'bigint':
        value = token.value;
        break;
    }

    if (root === undefined) {
      root = value;
    } else {
      const parent = stack[stack.length - 1];
      if (Array.isArray(parent)) {
        parent.push(value);
      } else {
        Object.defineProperty(parent, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    if (value !== null && typeof value === 'object' && !(value instanceof RawString)) {
      stack.push(value);

      if (Array.isArray(value)) {
        parseState = 'beforeArrayValue';
      } else {
        parseState = 'beforePropertyName';
      }
    } else {
      const current = stack[stack.length - 1];
      if (current == null) {
        parseState = 'end';
      } else if (Array.isArray(current)) {
        parseState = 'afterArrayValue';
      } else {
        parseState = 'afterPropertyValue';
      }
    }
  }

  function pop() {
    stack.pop();

    const current = stack[stack.length - 1];
    if (current == null) {
      parseState = 'end';
    } else if (Array.isArray(current)) {
      parseState = 'afterArrayValue';
    } else {
      parseState = 'afterPropertyValue';
    }
  }

  function invalidChar(ch: string | undefined): Error {
    if (ch === undefined) {
      return syntaxError(`JSON11: invalid end of input at ${line}:${column}`);
    }

    return syntaxError(`JSON11: invalid character '${formatChar(ch)}' at ${line}:${column}`);
  }

  function invalidEOF(): Error {
    return syntaxError(`JSON11: invalid end of input at ${line}:${column}`);
  }

  function invalidIdentifier(): Error {
    column -= 5;
    return syntaxError(`JSON11: invalid identifier character at ${line}:${column}`);
  }

  function separatorWarn(): void {
    console.warn(`JSON11: '\\u2028' or '\\u2029' in strings is not valid ECMAScript; consider escaping`);
  }

  function formatChar(ch: string): string {
    const replacements: Record<string, string> = {
      '\'': '\\\'',
      '"': '\\"',
      '\\': '\\\\',
      '\b': '\\b',
      '\f': '\\f',
      '\n': '\\n',
      '\r': '\\r',
      '\t': '\\t',
      '\v': '\\v',
      '\0': '\\0',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    };

    if (replacements[ch]) {
      return replacements[ch];
    }

    if (ch < ' ') {
      const hexString = ch.charCodeAt(0).toString(16);
      return '\\x' + ('00' + hexString).substring(hexString.length);
    }

    return ch;
  }

  function syntaxError(message: string): Error {
    const err = new SyntaxError(message);
    Object.defineProperty(err, 'lineNumber', {
      value: line,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(err, 'columnNumber', {
      value: column,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return err;
  }
}
