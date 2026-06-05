/* Leaf string/key serialization shared by the string serializer (`stringify`)
 * and the byte serializer (`stringify(..., { raw: true })`).
 *
 * Both serializers produce string/key fragments through these exact functions so
 * the byte output is byte-identical to the UTF-8 encoding of the string output.
 * Note `quoteWeights` is intentionally shared, accumulating per stringify call:
 * the chosen quote character depends on the quote balance across the whole
 * document, so both serializers must thread the same context to stay identical.
 */

import * as util from './util';
import { controlEscape, QuoteReplacements } from './escapes';

export type QuoteContext = {
  quoteWeights: Record<string, number>;
  quote?: string;
  quoteReplacements: QuoteReplacements;
  nulFollowedByDigit: string;
  withLegacyEscapes?: boolean;
};

export function quoteString(value: string, ctx: QuoteContext): string {
  let product = '';

  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    switch (c) {
      case '\'':
      case '"':
        ctx.quoteWeights[c]++;
        product += c;
        continue;

      case '\0':
        if (util.isDigit(value[i + 1])) {
          product += ctx.nulFollowedByDigit;
          continue;
        }
    }

    if (ctx.quoteReplacements[c]) {
      product += ctx.quoteReplacements[c];
      continue;
    }

    if (c < ' ') {
      product += controlEscape(c.charCodeAt(0), ctx.withLegacyEscapes);
      continue;
    }

    product += c;
  }

  const quoteChar = ctx.quote || Object.keys(ctx.quoteWeights).reduce((a, b) => (ctx.quoteWeights[a] < ctx.quoteWeights[b]) ? a : b);

  product = product.replace(new RegExp(quoteChar, 'g'), ctx.quoteReplacements[quoteChar]);

  return quoteChar + product + quoteChar;
}

export function serializeKey(key: string, ctx: QuoteContext): string {
  if (key.length === 0) {
    return quoteString(key, ctx);
  }

  const firstChar = String.fromCodePoint(key.codePointAt(0)!);
  if (!util.isIdStartChar(firstChar)) {
    return quoteString(key, ctx);
  }

  for (let i = firstChar.length; i < key.length; i++) {
    if (!util.isIdContinueChar(String.fromCodePoint(key.codePointAt(i)!))) {
      return quoteString(key, ctx);
    }
  }

  return key;
}
