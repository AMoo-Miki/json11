import { buildQuoteReplacements, nulFollowedByDigitReplacement } from './escapes';
import { quoteString, serializeKey, type QuoteContext } from './serializeShared';
import { RawString, RawValue } from './raw';
import { serializeToBytes } from './stringifyBytes';
import * as util from './util';

export type AllowList = (string | number)[];
export type Replacer = (this: any, key: string, value: any) => any;
export type StringifyQuoteOptions = {
  quote?: string,
  quoteNames?: boolean,
};
export type Stringify11Options = StringifyQuoteOptions & {
  /* Allow serializing BigInt values as <num>n.
   * When undefined or true, BigInt values are serialized with the `n` suffix.
   * When false, the `n` suffix is not included after the long numeral.
   */
  withBigInt?: boolean,
  /* Add a trailing comma to arrays and objects, like JSON5.
   * Applicable only when space is used for indenting.
   */
  trailingComma?: boolean,
  /* Use legacy escape sequences, like JSON5.
   * When true, \v, \0, and \x0-\x19 will be serialized as \v, \0, and \x0-\x19
   * When undefined or false, \v, \0, and \x0-\x19 will be serialized as \u000b, \u0000, and \u0000-\u0019
   */
  withLegacyEscapes?: boolean,
  /* Byte-mode output. When true, `stringify` returns a Uint8Array instead of a
   * string, and recognizes `RawValue`/`RawString` nodes which it injects as raw
   * bytes (pre-escaped, spliced verbatim, or escaped from raw bytes) so a secret
   * can reach the output buffer without ever becoming a JS String.
   */
  raw?: boolean,
  /* Maximum nesting depth the serializer will descend before throwing. Both the
   * string and byte serializers recurse once per nesting level, so a
   * deeply-nested value can overflow the JS call stack; this bounds it.
   * Defaults to util.MAX_DEPTH_DEFAULT. */
  maxDepth?: number,
};
export type StringifyOptions = Stringify11Options & {
  replacer?: Replacer | AllowList | null,
  space?: string | number | String | Number | null,
};

export function stringify(
  value: any,
  options: StringifyOptions & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: any,
  options?: StringifyOptions,
): string | undefined;

export function stringify(
  value: any,
  replacer: Replacer | null | undefined,
  space: string | number | String | Number | null | undefined,
  options: Stringify11Options & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: any,
  replacer?: Replacer | null,
  space?: string | number | String | Number | null,
  options?: Stringify11Options,
): string | undefined;

export function stringify(
  value: any,
  allowList: AllowList,
  space: string | number | String | Number | null | undefined,
  options: Stringify11Options & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: any,
  allowList?: AllowList,
  space?: string | number | String | Number | null,
  options?: Stringify11Options,
): string | undefined;

export function stringify(
  value: any,
  replacerOrAllowListOrOptions?: Replacer | StringifyOptions | AllowList | null,
  space?: string | number | String | Number | null,
  options?: Stringify11Options,
): string | undefined | Uint8Array {
  /* Open-ancestor set for cycle detection: membership is O(1) so a deeply
   * nested value does not pay an O(depth) scan per node. Set.has uses
   * SameValueZero, identical object identity to the prior Array.includes. */
  const stack = new Set<any>();
  let indent = '';
  let propertyList: string[] | undefined;
  let replacer: Replacer | undefined;
  let gap = '';
  let quote: string | undefined;
  let withBigInt: boolean | undefined;
  let withLegacyEscapes: boolean | undefined;
  let quoteNames: boolean = false;
  let trailingComma: string = '';
  let raw: boolean = false;
  let maxDepth: number = util.MAX_DEPTH_DEFAULT;

  const quoteWeights: Record<string, number> = {
    '\'': 0.1,
    '"': 0.2,
  };

  if (
    // replacerOrAllowListOrOptions is StringifyOptions
    replacerOrAllowListOrOptions != null &&
    typeof replacerOrAllowListOrOptions === 'object' &&
    !Array.isArray(replacerOrAllowListOrOptions)
  ) {
    gap = getGap(replacerOrAllowListOrOptions.space);
    if (replacerOrAllowListOrOptions.trailingComma) {
      trailingComma = ',';
    }
    quote = replacerOrAllowListOrOptions.quote?.trim?.();
    if (replacerOrAllowListOrOptions.quoteNames === true) {
      quoteNames = true;
    }
    if (typeof replacerOrAllowListOrOptions.replacer === 'function') {
      replacer = replacerOrAllowListOrOptions.replacer;
    }
    withBigInt = replacerOrAllowListOrOptions.withBigInt;
    withLegacyEscapes = replacerOrAllowListOrOptions.withLegacyEscapes === true;
    raw = replacerOrAllowListOrOptions.raw === true;
    maxDepth = replacerOrAllowListOrOptions.maxDepth ?? util.MAX_DEPTH_DEFAULT;
  } else {
    if (
      // replacerOrAllowListOrOptions is Replacer
      typeof replacerOrAllowListOrOptions === 'function'
    ) {
      replacer = replacerOrAllowListOrOptions;
    } else if (
      // replacerOrAllowListOrOptions is AllowList
      Array.isArray(replacerOrAllowListOrOptions)
    ) {
      propertyList = [];
      const propertySet: Set<string> = new Set();
      for (const v of replacerOrAllowListOrOptions) {
        const key = v?.toString?.();
        if (key !== undefined) propertySet.add(key);
      }
      propertyList = [...propertySet];
    }

    gap = getGap(space);
    quote = options?.quote?.trim?.();
    if (options?.quoteNames === true) {
      quoteNames = true;
    }
    withBigInt = options?.withBigInt;
    withLegacyEscapes = options?.withLegacyEscapes === true;
    if (options?.trailingComma) {
      trailingComma = ',';
    }
    raw = options?.raw === true;
    maxDepth = options?.maxDepth ?? util.MAX_DEPTH_DEFAULT;
  }

  const quoteReplacements = buildQuoteReplacements(withLegacyEscapes);
  const quoteReplacementForNulFollowedByDigit = nulFollowedByDigitReplacement(withLegacyEscapes);

  const quoteContext: QuoteContext = {
    quoteWeights,
    quote,
    quoteReplacements,
    nulFollowedByDigit: quoteReplacementForNulFollowedByDigit,
    withLegacyEscapes,
  };

  const nameSerializer = (key: string): string =>
    quoteNames ? quoteString(key, quoteContext) : serializeKey(key, quoteContext);

  if (raw) {
    return serializeToBytes(value, {
      gap,
      trailingComma,
      quoteContext,
      quoteNames,
      replacer,
      propertyList,
      withBigInt,
      maxDepth,
    });
  }

  return serializeProperty('', { '': value });

  function getGap(space?: string | number | String | Number | null) {
    if (typeof space === 'number' || space instanceof Number) {
      const num = Number(space);
      if (isFinite(num) && num > 0) {
        return ' '.repeat(Math.min(10, Math.floor(num)));
      }
    } else if (typeof space === 'string' || space instanceof String) {
      return space.substring(0, 10);
    }

    return '';
  }

  function serializeProperty(key: string, holder: any): string | undefined {
    let value = holder[key];

    if (value instanceof RawValue || value instanceof RawString) {
      throw new TypeError('JSON11: RawValue/RawString can only be serialized in byte mode; use stringify(value, { raw: true })');
    }

    if (value != null) {
      if (typeof value.toJSON11 === 'function') {
        value = value.toJSON11(key);
      } else if (typeof value.toJSON5 === 'function') {
        value = value.toJSON5(key);
      } else if (typeof value.toJSON === 'function') {
        value = value.toJSON(key);
      }
    }

    if (replacer) {
      value = replacer.call(holder, key, value);
    }

    if (value instanceof Number) {
      value = Number(value);
    } else if (value instanceof String) {
      value = String(value);
    } else if (value instanceof Boolean) {
      value = value.valueOf();
    }

    switch (value) {
      case null:
        return 'null';
      case true:
        return 'true';
      case false:
        return 'false';
    }

    if (typeof value === 'string') {
      return quoteString(value, quoteContext);
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'bigint') {
      return value.toString() + (withBigInt === false ? '' : 'n');
    }

    if (typeof value === 'object') {
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value);
    }

    return undefined;
  }

  function serializeObject(value: any): string {
    if (stack.has(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.size >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.add(value);

    let stepback = indent;
    indent = indent + gap;

    let keys = propertyList || Object.keys(value);
    let partial: string[] = [];
    for (const key of keys) {
      const propertyString = serializeProperty(key, value);
      if (propertyString !== undefined) {
        let member = nameSerializer(key) + ':';
        if (gap !== '') {
          member += ' ';
        }
        member += propertyString;
        partial.push(member);
      }
    }

    let final: string;
    if (partial.length === 0) {
      final = '{}';
    } else {
      let properties: string;
      if (gap === '') {
        properties = partial.join(',');
        final = '{' + properties + '}';
      } else {
        properties = partial.join(',\n' + indent);
        final = '{\n' + indent + properties + trailingComma + '\n' + stepback + '}';
      }
    }

    stack.delete(value);
    indent = stepback;
    return final;
  }

  function serializeArray(value: any[]): string {
    if (stack.has(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.size >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.add(value);

    let stepback = indent;
    indent = indent + gap;

    let partial: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const propertyString = serializeProperty(String(i), value);
      partial.push((propertyString !== undefined) ? propertyString : 'null');
    }

    let final: string;
    if (partial.length === 0) {
      final = '[]';
    } else {
      if (gap === '') {
        let properties = partial.join(',');
        final = '[' + properties + ']';
      } else {
        let properties = partial.join(',\n' + indent);
        final = '[\n' + indent + properties + trailingComma + '\n' + stepback + ']';
      }
    }

    stack.delete(value);
    indent = stepback;
    return final;
  }
}
