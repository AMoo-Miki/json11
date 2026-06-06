import { parse } from './parse';
import { stringify } from './stringify';
import { RawString, RawValue, unsafeEncodeAsJSON } from './raw';

export {
  parse,
  stringify,
  RawString,
  RawValue,
  unsafeEncodeAsJSON,
}

// Also expose a default export so consumers can use any import style:
//   import JSON11 from 'json11'         (default)
//   import * as JSON11 from 'json11'    (namespace)
//   import { parse } from 'json11'      (named)
//   const JSON11 = require('json11')    (CJS)
export default {
  parse,
  stringify,
  RawString,
  RawValue,
  unsafeEncodeAsJSON,
};
