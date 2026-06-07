import { buildQuoteReplacements, nulFollowedByDigitReplacement } from './escapes';
import { quoteString, serializeKey, type QuoteContext } from './serializeShared';
import { RawString, RawValue } from './raw';
import { serializeToBytes } from './stringifyBytes';
import * as util from './util';

export type AllowList = (string | number)[];
export type Replacer = (this: unknown, key: string, value: unknown) => unknown;
/* `space` accepts boxed `String`/`Number` objects (e.g. `new Number(2)`) as well
 * as primitives, matching JSON5; getGap unwraps them at runtime. The wrapper
 * object types are deliberate here, not the mistake the lint rule guards against. */
// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
export type Space = string | number | String | Number | null;
export type StringifyQuoteOptions = {
  quote?: string,
  quoteNames?: boolean,
};
/* `pureJson` is mutually exclusive with the output-shaping options it subsumes.
 * Because it overrides all of them at serialize time, the type forbids passing
 * any of them alongside `pureJson: true`, so a caller can't set an option that
 * would be silently ignored. `raw`/`maxDepth` (and `space`/`replacer` on
 * `StringifyOptions`) are orthogonal to JSON validity and stay allowed in both
 * arms. The two helper shapes are inlined to keep the public d.ts surface to
 * just `StringifyQuoteOptions`/`Stringify11Options`/`StringifyOptions`. */
export type Stringify11Options = {
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
} & (
  | (StringifyQuoteOptions & {
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
    /* How to serialize the non-finite numbers Infinity, -Infinity, and NaN, none
     * of which is valid JSON.
     *   'literal' (default) — emit them verbatim (`Infinity`/`-Infinity`/`NaN`),
     *     valid JSON11 but invalid JSON. This is the historical behavior.
     *   'null'    — emit `null` instead, matching the global `JSON.stringify`, so
     *     the output is valid JSON.
     *   'throw'   — throw a TypeError rather than emit an invalid value.
     * Finite numbers are unaffected. */
    nonFinite?: 'literal' | 'null' | 'throw',
    /* Emit strict, valid JSON. When true this overrides the other output-shaping
     * options: double quotes, quoted property names, BigInt as a bare integer
     * (valid JSON number text — a consumer reading it as a double may lose
     * precision), non-finite numbers as `null`, no legacy escapes, and no
     * trailing comma. `space` is left untouched (indentation is valid JSON).
     * Use this instead of composing the individual flags by hand. */
    pureJson?: false,
  })
  | {
    /* When `pureJson` is true the output-shaping options it overrides are
     * forbidden, so none is set only to be silently ignored. */
    quote?: never,
    quoteNames?: never,
    withBigInt?: never,
    trailingComma?: never,
    withLegacyEscapes?: never,
    nonFinite?: never,
    pureJson: true,
  }
);
export type StringifyOptions = Stringify11Options & {
  replacer?: Replacer | AllowList | null,
  space?: Space,
};

/* The hooks a value may define to customize its own serialization, honored in
 * the order toJSON11 > toJSON5 > toJSON. */
interface ToJsonHooks {
  toJSON11?: (key: string) => unknown;
  toJSON5?: (key: string) => unknown;
  toJSON?: (key: string) => unknown;
}

/* A value that holds the property being serialized: the synthetic `{ '': value }`
 * root, a parsed object, or an array indexed by stringified position. */
type Holder = { [key: string]: unknown };

export function stringify(
  value: unknown,
  options: StringifyOptions & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: unknown,
  options?: StringifyOptions,
): string | undefined;

export function stringify(
  value: unknown,
  replacer: Replacer | null | undefined,
  space: Space | undefined,
  options: Stringify11Options & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: unknown,
  replacer?: Replacer | null,
  space?: Space,
  options?: Stringify11Options,
): string | undefined;

export function stringify(
  value: unknown,
  allowList: AllowList,
  space: Space | undefined,
  options: Stringify11Options & { raw: true },
): Uint8Array | undefined;

export function stringify(
  value: unknown,
  allowList?: AllowList,
  space?: Space,
  options?: Stringify11Options,
): string | undefined;

export function stringify(
  value: unknown,
  replacerOrAllowListOrOptions?: Replacer | StringifyOptions | AllowList | null,
  space?: Space,
  options?: Stringify11Options,
): string | undefined | Uint8Array {
  /* Open-ancestor set for cycle detection: membership is O(1) so a deeply
   * nested value does not pay an O(depth) scan per node. Set.has uses
   * SameValueZero, identical object identity to the prior Array.includes. */
  const stack = new Set<object>();
  let indent = '';
  let propertyList: string[] | undefined;
  let replacer: Replacer | undefined;
  let gap = '';
  let quote: string | undefined;
  let withBigInt: boolean | undefined;
  let withLegacyEscapes: boolean | undefined;
  let quoteNames: boolean = false;
  let trailingComma: string = '';
  let nonFinite: 'literal' | 'null' | 'throw' = 'literal';
  let pureJson: boolean;
  let raw: boolean;
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
    nonFinite = replacerOrAllowListOrOptions.nonFinite ?? 'literal';
    pureJson = replacerOrAllowListOrOptions.pureJson === true;
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
    nonFinite = options?.nonFinite ?? 'literal';
    pureJson = options?.pureJson === true;
    raw = options?.raw === true;
    maxDepth = options?.maxDepth ?? util.MAX_DEPTH_DEFAULT;
  }

  /* Evaluated last so it wins over every other output-shaping option: force the
   * settings that make the output strict, valid JSON. `space`/`maxDepth`/
   * `replacer` are orthogonal to JSON validity and left as the caller set them. */
  if (pureJson) {
    quote = '"';
    quoteNames = true;
    withBigInt = false;
    withLegacyEscapes = false;
    trailingComma = '';
    nonFinite = 'null';
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
      nonFinite,
      maxDepth,
    });
  }

  return serializeProperty('', { '': value });

  function getGap(space?: Space) {
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

  function serializeProperty(key: string, holder: Holder): string | undefined {
    let value: unknown = holder[key];

    if (value instanceof RawValue || value instanceof RawString) {
      throw new TypeError('JSON11: RawValue/RawString can only be serialized in byte mode; use stringify(value, { raw: true })');
    }

    if (value != null) {
      const hooks = value as ToJsonHooks;
      if (typeof hooks.toJSON11 === 'function') {
        value = hooks.toJSON11(key);
      } else if (typeof hooks.toJSON5 === 'function') {
        value = hooks.toJSON5(key);
      } else if (typeof hooks.toJSON === 'function') {
        value = hooks.toJSON(key);
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
      if (!isFinite(value) && nonFinite !== 'literal') {
        if (nonFinite === 'throw') {
          throw new TypeError(`Cannot serialize non-finite number ${String(value)} as JSON`);
        }
        return 'null';
      }
      return String(value);
    }

    if (typeof value === 'bigint') {
      return value.toString() + (withBigInt === false ? '' : 'n');
    }

    if (typeof value === 'object' && value !== null) {
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value);
    }

    return undefined;
  }

  function serializeObject(value: object): string {
    if (stack.has(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.size >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.add(value);

    const stepback = indent;
    indent = indent + gap;

    const keys = propertyList || Object.keys(value);
    const partial: string[] = [];
    for (const key of keys) {
      const propertyString = serializeProperty(key, value as Holder);
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

  function serializeArray(value: unknown[]): string {
    if (stack.has(value)) {
      throw TypeError('Converting circular structure to JSON11');
    }
    if (stack.size >= maxDepth) {
      throw TypeError(`JSON11: maximum nesting depth ${maxDepth} exceeded`);
    }

    stack.add(value);

    const stepback = indent;
    indent = indent + gap;

    const partial: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const propertyString = serializeProperty(String(i), value as unknown as Holder);
      partial.push((propertyString !== undefined) ? propertyString : 'null');
    }

    let final: string;
    if (partial.length === 0) {
      final = '[]';
    } else {
      if (gap === '') {
        const properties = partial.join(',');
        final = '[' + properties + ']';
      } else {
        const properties = partial.join(',\n' + indent);
        final = '[\n' + indent + properties + trailingComma + '\n' + stepback + ']';
      }
    }

    stack.delete(value);
    indent = stepback;
    return final;
  }
}
