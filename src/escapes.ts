/* Shared string-escaping table for the serializers.
 *
 * Both the string serializer (`stringify`, char-out) and the byte serializer
 * (`stringify(..., { raw: true })`, byte-out) build their escaping from this one
 * source of truth so that, by construction, a value serialized to bytes is
 * byte-identical to the UTF-8 encoding of the same value serialized to a string.
 * This is the invariant that makes lifted escaped spans round-trip safely.
 */

export type QuoteReplacements = { [key: string]: string };

/* The non-quote-character escape replacements, matching JSON5/JSON11 semantics.
 * `withLegacyEscapes` controls whether \v, \0, and \x00 use the short JSON5
 * forms (`\v`, `\0`, `\x00`) or the safer \u escapes.
 */
export function buildQuoteReplacements(withLegacyEscapes?: boolean): QuoteReplacements {
  return {
    '\'': '\\\'',
    '"': '\\"',
    '\\': '\\\\',
    '\b': '\\b',
    '\f': '\\f',
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\v': withLegacyEscapes ? '\\v' : '\\u000b',
    '\0': withLegacyEscapes ? '\\0' : '\\u0000',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
}

/* The escape for a NUL that is immediately followed by a decimal digit; the
 * short `\0` form would otherwise be ambiguous with an octal escape.
 */
export function nulFollowedByDigitReplacement(withLegacyEscapes?: boolean): string {
  return withLegacyEscapes ? '\\x00' : '\\u0000';
}

/* The escape for a control character (code point < 0x20) that has no dedicated
 * short form. Returns an ASCII-only escape sequence.
 */
export function controlEscape(codeUnit: number, withLegacyEscapes?: boolean): string {
  const hexString = codeUnit.toString(16);
  return withLegacyEscapes
    ? '\\x' + ('00' + hexString).substring(hexString.length)
    : '\\u' + hexString.padStart(4, '0');
}
