#!/usr/bin/env node

import { createReadStream, createWriteStream, realpathSync } from 'fs';
import { parse as parsePath, format, basename } from 'path';
import {  version } from '../package.json';
import { parse, stringify } from './index';
import type { StringifyOptions } from './stringify';

interface Args {
  convert?: boolean;
  space?: string | number;
  quote?: string;
  quoteNames?: boolean;
  noBigIntSuffix?: boolean;
  trailingComma?: boolean;
  legacyEscapes?: boolean;
  nonFinite?: string;
  pureJson?: boolean;
  validate?: boolean;
  outFile?: string;
  version?: boolean;
  help?: boolean;
  file?: string;
  defaults: string[];
}

if (isMainModule()) {
  const args = parseArgs(process.argv);
  if (args.version) {
    console.log(`v${version}`);
  } else if (args.help) {
    printUsage();
  } else {
    processInput(args);
  }
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    defaults: [],
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--convert':
      case '-c':
        args.convert = true;
        break;

      case '--space':
      case '-s':
        args.space = argv[++i];
        break;

      case '--quote':
        args.quote = argv[++i];
        break;

      case '--quote-names':
        args.quoteNames = true;
        break;

      case '--no-bigint-suffix':
        args.noBigIntSuffix = true;
        break;

      case '--trailing-comma':
        args.trailingComma = true;
        break;

      case '--legacy-escapes':
        args.legacyEscapes = true;
        break;

      case '--non-finite':
        args.nonFinite = argv[++i];
        break;

      case '--pure-json':
        args.pureJson = true;
        break;

      case '--validate':
      case '-v':
        args.validate = true;
        break;

      case '--out-file':
      case '-o':
        args.outFile = argv[++i];
        break;

      case '--version':
      case '-V':
        args.version = true;
        break;

      case '--help':
      case '-h':
        args.help = true;
        break;

      default:
        args.file = arg;
        break;
    }
  }

  return args;
}

/* Map the passed flags to JSON11 `stringify` options. The CLI is a thin
 * pass-through: an option is only set when its flag was given, so with no flags
 * `stringify` applies its own defaults and the invoker composes flags to choose
 * the output flavor (strict JSON, JSON5-ish, JSON11).
 *
 * The programmatic `Stringify11Options` type makes `pureJson` mutually exclusive
 * with the granular shaping options. The CLI is deliberately more lenient — it
 * lets `--pure-json` coexist with those flags (pure JSON wins at serialize time)
 * — so it accumulates into this permissive shape and hands it to `stringify`,
 * which applies the override. */
type CliStringifyOptions = {
  space?: StringifyOptions['space'];
  quote?: string;
  quoteNames?: boolean;
  withBigInt?: boolean;
  trailingComma?: boolean;
  withLegacyEscapes?: boolean;
  nonFinite?: 'literal' | 'null' | 'throw';
  pureJson?: boolean;
};

export function buildStringifyOptions(args: Args): StringifyOptions {
  const options: CliStringifyOptions = {};

  if (args.space !== undefined) {
    options.space = args.space === 't' || args.space === 'tab' ? '\t' : Number(args.space);
  }

  if (args.quote !== undefined) {
    if (args.quote !== '"' && args.quote !== '\'') {
      throw new TypeError(`--quote must be a single ' or " character`);
    }
    options.quote = args.quote;
  }

  if (args.quoteNames) options.quoteNames = true;
  if (args.noBigIntSuffix) options.withBigInt = false;
  if (args.trailingComma) options.trailingComma = true;
  if (args.legacyEscapes) options.withLegacyEscapes = true;

  if (args.nonFinite !== undefined) {
    if (args.nonFinite !== 'literal' && args.nonFinite !== 'null' && args.nonFinite !== 'throw') {
      throw new TypeError('--non-finite must be one of: literal, null, throw');
    }
    options.nonFinite = args.nonFinite;
  }

  if (args.pureJson) options.pureJson = true;

  return options as StringifyOptions;
}

/* Parse JSON11 input and serialize it back with JSON11's own `stringify`.
 * Returns the serialized text, or `undefined` when only validating. Throws on
 * malformed input or an invalid flag value; the caller decides the exit code. */
export function transform(input: string, args: Args): string | undefined {
  const value = parse(input);
  if (args.validate) return undefined;
  return stringify(value, buildStringifyOptions(args));
}

function processInput(args: Args): void {
  const inputStream = args.file ? createReadStream(args.file) : process.stdin;

  let json11 = '';
  inputStream.on('data', (data: Buffer) => {
    json11 += data.toString();
  });

  inputStream.on('end', () => {
    try {
      const output = transform(json11, args);
      if (output !== undefined) {
        const outputStream = getOutputStream(args);
        outputStream.write(output);
      }
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });
}

function getOutputStream(args: Args): NodeJS.WritableStream {
  if (args.convert && args.file && !args.outFile) {
    const parsedFilename = parsePath(args.file);
    const outFilename = format({
      ...parsedFilename,
      base: basename(parsedFilename.base, parsedFilename.ext) + '.json',
    });

    return createWriteStream(outFilename);
  } else if (args.outFile) {
    return createWriteStream(args.outFile);
  } else {
    return process.stdout;
  }
}

export function usageText(): string {
  return `
  Usage: json11 [options] <file>

  If <file> is not provided, then STDIN is used.

  With no output flags the CLI emits JSON11 (stringify's defaults), not strict
  JSON. Compose the output-shaping flags below to choose the flavor you want, or
  pass --pure-json for strict, valid JSON.

  Options:

    -c, --convert            Convert <file> to JSON, writing alongside it as <file>.json
    -s, --space <n|t|tab>    The number of spaces to indent, or 't'/'tab' for tabs
        --quote <'|">         Force ' or " as the string quote
        --quote-names        Quote object keys
        --no-bigint-suffix   Emit BigInt values as bare integers (no 'n' suffix)
        --trailing-comma     Add a trailing comma (only when --space is set)
        --legacy-escapes     Use legacy escape sequences (\\v, \\0, \\x..)
        --non-finite <mode>  How to emit Infinity/-Infinity/NaN: 'literal'
                             (default), 'null' (valid JSON), or 'throw'
        --pure-json          Emit strict, valid JSON. Overrides the output-shaping
                             flags above (double quotes, quoted keys, bare-integer
                             BigInt, non-finite as null); --space still applies
    -o, --out-file [file]    Output to the specified file, otherwise STDOUT
    -v, --validate           Validate JSON11 but do not output anything
    -V, --version            Output the version number
    -h, --help               Output usage information`;
}

function printUsage(): void {
  console.log(usageText());
}

/* True only when this file is the process entry point, so importing it (e.g.
 * from the CLI test) does not kick off arg parsing or stdin reads. realpathSync
 * on both sides makes the npm bin symlink resolve to the same real path. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  let here: string;
  try {
    here = decodeURIComponent(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }

  try {
    return realpathSync(entry) === realpathSync(here);
  } catch {
    return entry === here;
  }
}
