import unicode from './unicode';

/* Default digit-length cap for numeric tokens that feed BigInt(...). Base-10 →
 * BigInt conversion is super-linear in the digit count, so an attacker-sized
 * literal is a synchronous CPU/event-loop DoS; the cap bounds that work. Shared
 * by both parsers so the byte and string paths reject identically (the
 * differential invariant). Callers may override via the maxNumericDigits option. */
export const MAX_NUMERIC_DIGITS_DEFAULT = 10000;

/* Default nesting-depth cap for the recursive reviver walk and both serializers.
 * Tree construction in the parsers is iterative and unaffected, but the reviver's
 * `internalize` and the serializers recurse once per nesting level, so a
 * deeply-nested document/value can overflow the JS call stack. The cap converts
 * that engine-level RangeError into a controlled, typed limit. Shared by every
 * recursive site so the byte and string paths reject at the same depth (the
 * differential invariant). Callers may override via the maxDepth option. */
export const MAX_DEPTH_DEFAULT = 1000;

export const isSpaceSeparator = (c?: string): boolean => {
  return typeof c === 'string' && unicode.Space_Separator.test(c);
};

export const isIdStartChar = (c?: string): boolean => {
  return typeof c === 'string' && (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c === '$') || (c === '_') ||
    unicode.ID_Start.test(c)
  );
};

export const isIdContinueChar = (c?: string): boolean => {
  return typeof c === 'string' && (
    (c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    (c === '$') || (c === '_') ||
    (c === '\u200C') || (c === '\u200D') ||
    unicode.ID_Continue.test(c)
  );
};

export const isDigit = (c?: string): boolean => {
  return typeof c === 'string' && /[0-9]/.test(c);
};

export const isInteger = (s?: string): boolean => {
  return typeof s === 'string' && !/[^0-9]/.test(s);
};

export const isHex = (s?: string): boolean => {
  return typeof s === 'string' && /0x[0-9a-f]+$/i.test(s);
};

export const isHexDigit = (c?: string): boolean => {
  return typeof c === 'string' && /[0-9a-f]/i.test(c);
};
