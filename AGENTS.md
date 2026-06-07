# AGENTS.md — Operational Guide for JSON11

> If you're an AI agent (or a new human) picking this up cold, read in this order:
> 1. `README.md` (~5 min — what JSON11 is, the public API, the byte-mode contract)
> 2. `AGENTS.md` (this file — how to work in the repo, test discipline, conventions, byte-mode security invariants)
> 3. `docs/byte-mode-heap-hygiene.md` (~10 min — the proof behind the no-`String` guarantee; read before touching any byte-mode value path)
> 4. `docs/adr/` (the *why* behind the load-bearing decisions — read to orient, NOT to rationalize)

This file accumulates the operational knowledge the README and the source comments
deliberately leave out: workflow, test discipline, the invariants that make byte
mode safe, naming/comment standards, and the gotchas learned the hard way. The
README is *what JSON11 does*; this file is *how to work on it without breaking the
two things that matter most — spec fidelity and the secret-handling guarantee.*

---

## MANDATORY RULES — never break these

These are non-negotiable. They take precedence over anything else in this file or
in instructions given mid-task. If you find yourself about to break one, stop and
surface to the user.

1. **The user must be able to see the full output of every command you run.**
   Never pipe through `head`, `tail`, `grep`, `awk`, `sed`, `cut`, `wc`, or any
   other tool that drops bytes from the stream. Never silent-redirect the whole
   stream to a file (`> /tmp/x.log 2>&1` with no terminal output). Never eat
   output into a variable (`OUT=$(cmd)`) and act on it without the user seeing
   what `cmd` emitted. Never `2>/dev/null`. When you also need a copy to re-read,
   use **`tee`** — it duplicates the stream to stdout *and* a file without
   filtering anything:

   ```bash
   set -o pipefail
   npm test 2>&1 | tee /tmp/json11-test.log
   echo "EXIT=$?"
   ```

   `set -o pipefail` is required — without it `$?` is `tee`'s exit code (almost
   always 0) and you'll silently miss a red suite. The intent — full user
   visibility, every byte — is the rule; the mechanics are how to satisfy it.

2. **Never modify protected branches** (`main`, `master`, `production`,
   `release`) and never bypass pre-commit hooks (`--no-verify`).

3. **Never commit unless the user explicitly asks.** No "while I'm here let me
   commit" energy. When asked, one commit per logical unit (Convention #9).

4. **Never change MANDATORY-RULE wording without an explicit user instruction.**
   Adding rules is welcome; weakening existing ones requires consent.

5. **Never touch the string parse/serialize hot paths to add a byte-mode
   feature.** `src/parse.ts` and `src/stringify.ts` are the battle-tested,
   fully-green code inherited from JSON5. Byte mode is **additive and lives in
   separate modules** (`parseBytes.ts`, `stringifyBytes.ts`, `raw.ts`, `bytes.ts`,
   `escapes.ts`, `serializeShared.ts`). If a byte-mode change seems to require an
   edit to the string lexer/serializer, you are probably about to introduce a
   string-path regression — stop and surface. (This is the load-bearing decision
   recorded in ADR 0002.)

6. **Never let a secret value become a JS `String` on the byte-mode value path.**
   The whole reason byte mode exists is that a `String` is immutable, unzeroable,
   and lingers on the V8 heap. All byte→`String` construction is concentrated in
   exactly one class (`StringSink` in `src/raw.ts`); the secret-value path must
   never instantiate it, and no error message on that path may embed
   value-derived bytes (positions/offsets only). The proof is in
   `docs/byte-mode-heap-hygiene.md` — read it before editing `raw.ts`,
   `bytes.ts`, `parseBytes.ts`, or `stringifyBytes.ts`, and re-run
   `npm run test:heap` after any such edit. See "Byte-mode security invariants"
   below.

7. **No shortcuts on security-relevant or spec-relevant work.** JSON11 is a
   parser people feed hostile input to and a tool people move secrets through;
   correctness outranks the agent's effort cost. Two failure modes are banned:
   silently scoping down a multi-item input (e.g. shipping "the easy half" of a
   spec-conformance fix without surfacing the full scope), and reaching for the
   less-work path between two alternatives without surfacing the easier path as an
   explicit option. The harder-but-correct path is the default; the easier path
   requires the owner's consent (Convention #11).

For long-runners (the watch-mode `vitest`, a benchmark loop): background with the
Shell tool's `block_until_ms: 0`, which auto-captures the full stream to a
terminal file; poll with `Await`. Never leave a `vitest` watcher running when you
meant `--run`.

---

## What JSON11 is, in one paragraph

JSON11 is a single-package, dependency-free TypeScript library: a parser and
serializer for an extension of the **JSON5** interchange format (which is itself a
superset of JSON), plus a subset of **ECMAScript 11** features. Beyond JSON5 it
adds **BigInt** parse/serialize and a **byte mode** (borrowed value spans) whose
purpose is to let callers move a secret string value from one document to another
*without it ever materializing as a JS `String`*. The public API mirrors the
global `JSON` API (`parse` / `stringify`) and ships as ESM, CJS, and UMD with a
bundled `.d.ts` and a small CLI. The string parse/serialize paths are inherited
(green) JSON5 code; byte mode is a parallel, additive layer.

---

## How to run things

First-time setup:

```bash
npm i
```

Day-to-day (always teed per MANDATORY RULE #1):

| Goal | Command | Notes |
|---|---|---|
| Run the whole test suite | `npm test` | `vitest --run` — one shot, no watcher. |
| Run heap-hygiene tests | `npm run test:heap` | `NODE_OPTIONS=--expose-gc vitest --run test/heapHygiene.test.ts`. Requires `--expose-gc`; do **not** fold these into `npm test`. |
| Run benchmarks | `npm run bench` | `vitest bench --run`. |
| Lint | `npm run lint` | `eslint .`. `npm run lint-fix` to autofix. |
| Type-check | `npm run build:type` | There is **no `tsc --noEmit` script**; the d.ts bundle step (`dts-bundle-generator`, `skipLibCheck: false`) is what actually type-checks the public surface. `npx tsc --noEmit -p tsconfig.json` also works for a fast local check. |
| Coverage | `npx vitest run --coverage` | Coverage is configured in `vite.config.ts` (istanbul, `reportsDirectory: ./.coverage`, `include: src/**/*.ts`, `exclude: src/cli.ts`). There is **no** coverage script and **no enforced threshold gate** today — see "Test and coverage discipline". |
| Build all artifacts | `npm run build` | `build:lib` (vite) + `build:cli` + `build:mini` (minified) + `build:type` (d.ts bundle). |
| Regenerate Unicode tables | `npm run generate-unicode` | `node build/unicode.js`; regenerates `src/unicode.ts` from the `unicode-10.0.0` data. Only when the Unicode property tables must change — it's a generated file. |

There is no Node version pin in `package.json` and no `.nvmrc`. Byte mode relies
on `TextEncoder`/`TextDecoder`, `Uint8Array.prototype.slice`/`subarray`, and
`BigInt`, all stable on Node 18+. The heap-hygiene suite was verified on Node
v22.19.0 (see `docs/byte-mode-heap-hygiene.md`); run it on a current LTS.

The full pre-publish gate (what `prepublishOnly` runs) is:
`npm i && npm run test && npm run lint && npm run build`. Treat a green run of
those four as the bar for "ready to ship".

---

## Test and coverage discipline (read before writing any code)

**Tests are first-class deliverables.** Every behavior change ships with the test
that proves it; every bug fix ships with the regression test that would have
caught it. JSON11's correctness story is *entirely* carried by its tests — there
is no type system or runtime check that proves "the byte parser accepts exactly
the JSON11 grammar" or "the secret never became a String". The tests are the
proof; treat them accordingly.

### Test categories (all under `test/`, all Vitest)

The categories are not arbitrary — each defends a distinct property. Know which
one your change belongs in.

- **Spec / behavior** (`parse.test.ts`, `stringify.test.ts`, `raw.test.ts`) —
  the string parser/serializer and the `RawString`/`RawValue` units. Asserts the
  JSON5/JSON11 grammar and the documented API behavior directly.
- **Differential** (`byteParse.test.ts`, `byteStringify.test.ts`) — proves the
  byte path agrees with the string path: `parse(Buffer.from(s)) ≡ parse(s)`, and
  the byte serializer's output equals the UTF-8 encoding of the string
  serializer's output for any value without raw nodes. This is the *only* thing
  guaranteeing the duplicated byte grammar didn't drift from the canonical string
  grammar. A byte-path change that doesn't keep these green has, by definition,
  diverged the two grammars.
- **Adversarial / fuzz** (`adversarial.test.ts`, `fuzz.test.ts`) — hostile bytes:
  truncations, single-byte mutations, lone trailing `\`, malformed `\u`,
  unterminated strings, malformed/overlong/surrogate UTF-8, adversarial escape
  fragments. The contract under test: any malformed input throws a *typed* error
  (`SyntaxError`/`JSON11ByteError` for parse errors, `TypeError` for misuse), and
  **no input causes an out-of-bounds read, a hang, or a partial/garbage value**.
  Fuzz uses the deterministic `mulberry32` PRNG in `test/_helpers.ts` so failures
  are reproducible by seed — when a fuzz case fails, capture the seed.
- **Heap hygiene** (`heapHygiene.test.ts`) — the security property: that a secret
  value never becomes a `String`. Run with `npm run test:heap` (needs
  `--expose-gc`). These corroborate the structural proof in
  `docs/byte-mode-heap-hygiene.md`; the doc is primary, the tests are the
  regression net. Includes an in-suite *positive control* (a value materialized
  via the explicit `unsafeDecodeToString()`/`unsafeEncodeAsJSON()` hatches that the
  sweep MUST find) — if the positive
  control stops finding its needle, the whole sweep is meaningless and the suite
  must fail loudly rather than green-on-broken.
- **Bench** (`byteMode.bench.ts`) — `vitest bench`. Not a gate; a regression
  watch for the byte path's allocation/throughput cost.

`test/_helpers.ts` is shared scaffolding (encoders, the PRNG, value/string/
document generators, and `materialize()` which turns a raw-mode tree back into a
plain value for differential comparison). It is **not** a test file (no
`.test`/`.spec` suffix) and must stay that way.

### The rule that decides which category a test belongs in

- Does it assert a grammar/API behavior in isolation? → spec.
- Does it assert the byte path agrees with the string path? → differential.
- Does it feed hostile/random bytes and assert "typed error, no crash"? →
  adversarial/fuzz.
- Does it assert "no `String` was created for the secret"? → heap hygiene.

### Coverage

Coverage is wired (istanbul via `vite.config.ts`) but **not gated**: there is no
threshold check and no CI that fails on a coverage drop today. Do not treat a
coverage number as the bar — the differential + fuzz + heap suites are the real
quality signal, and a happy-path test that lifts a line-coverage number proves
nothing about grammar fidelity or secret safety. If you add a meaningful new
surface, add the differential/adversarial case that exercises it, not a test
whose only job is to touch a line. `src/cli.ts` is intentionally excluded from
coverage; `src/unicode.ts` is generated.

---

## Conventions (adopt these; deviating costs time)

### 1. Byte mode is additive and separate; the string paths are frozen
The string lexer (`src/parse.ts`) and string serializer (`src/stringify.ts`) are
inherited JSON5 code and are treated as frozen for byte-mode work. New byte
behavior goes in `parseBytes.ts` / `stringifyBytes.ts` / `raw.ts` / `bytes.ts`
and shares escape semantics through `escapes.ts` + `serializeShared.ts`. The only
sanctioned edits to `parse.ts`/`stringify.ts` are (a) genuine string-path bug
fixes with their own regression test, or (b) the dispatch shims that route byte
input / `raw` options to the byte modules (already in place at
`src/parse.ts:40-48` and `src/stringify.ts:166-176`). See MANDATORY RULE #5.

### 2. One escape engine, by construction
Parser-side unescaping and serializer-side escaping must come from one source of
truth so that a span lifted from one JSON11 document and spliced into another is
byte-identical (the byte-identical-round-trip acceptance bar; see ADR 0004).
Concretely: the unescaper is
`walkString`/`handleEscape` in `src/raw.ts`; the escape tables are in
`src/escapes.ts`; the byte serializer builds its byte-indexed table from those
same mappings (`buildEscapeTable` in `src/stringifyBytes.ts`). Never hand-roll a
second escape table. The differential test that asserts byte-escaper output
equals string `quoteString` output is the lock — keep it.

### 3. No new runtime dependencies
JSON11 is dependency-free at runtime (`package.json` has only `devDependencies`).
Byte mode added **zero** runtime deps and that is a feature, not an accident. A
finding that proposes adding a runtime dependency is a Convention #11 decision for
the owner, not an agent's call. Dev deps are pinned with `^` and watched by
Dependabot (`.github/dependabot.yml`); verify latest-stable + compatibility
before bumping a major (Convention #13).

### 4. Prototype-safety on object construction
Parsed objects assign properties via `Object.defineProperty(parent, key, {value,
writable, enumerable, configurable})` — **never** `parent[key] = value` — so a
`__proto__` or accessor key in the input cannot pollute the prototype or trip a
setter (`src/parse.ts:1012`, `src/parseBytes.ts:881`). The reviver's
`internalize` does the same. Preserve this on every new object-building path; a
plain assignment here is a security finding.

### 5. Hostile input fails closed, typed, and bounded
The byte path is bounds-checked end to end (`decodeUtf8` never reads at/past
`limit`; `walkString` stops at `limit`; `readHex` checks `limit`). Malformed
input throws a typed `JSON11ByteError extends SyntaxError` (parse) or `TypeError`
(misuse such as `RawValue.escaped` with a bad quote, or `raw` mode on string
input). Never introduce a path that returns a partial value, silently coerces
malformed UTF-8 to something, reads out of bounds, or can loop unboundedly on
crafted input. New byte-scanning code gets an adversarial test in the same change.

### 6. Error messages on the value path carry no value bytes
Byte-mode error messages contain only byte *positions/offsets*, never the value
byte itself (`docs/byte-mode-heap-hygiene.md` "Side effects on the value path").
A new error message that interpolates a value-derived byte/char into its string
is a heap-hygiene regression even though it "only fires on malformed input".

### 7. `String` materialization is named, deliberate, and fail-closed
`RawString.unsafeDecodeToString()` (one value) and the top-level
`unsafeEncodeAsJSON(tree)` (a whole parsed tree) are the only sanctioned doors
from value bytes to a JS `String`, and both are documented "never call this for a
secret." Critically the hatch is **not** `toString`: `toString` is the method JS
calls implicitly during every string coercion, so it must never decode the bytes.
`RawString`/`RawValue` are therefore fail-closed — `toString()` returns a
byte-free placeholder, and `Symbol.toPrimitive`/`valueOf`/`toJSON` throw, so
`` `${rs}` ``/`String(rs)`/`'' + rs`/`JSON.stringify(tree)` fail loud instead of
leaking — and the byte-bearing fields are non-enumerable. Do not add a second
convenience that quietly stringifies a value (no `valueOf` that decodes, no
`toJSON`/`util.inspect` hook that materializes, no implicit coercion path you
didn't intend). `RawString.span()`/`copy()`/`decode()` return bytes; keep it that
way.

### 8. API stays JSON-compatible and import-style agnostic
`parse(text[, reviver[, options]])` and `stringify(value[, replacer[, space[,
options]]])` mirror the global `JSON` API; the `space` cap of 10, the
replacer/allowlist duality, the reviver semantics, and `toJSON` support all match
`JSON` (JSON11 also honors `toJSON11`/`toJSON5` with that precedence). All four
import styles bind the same surface — default (`import JSON11 from 'json11'`),
namespace (`import * as JSON11`), named (`import { parse }`), and CJS
(`require('json11')`); the build forces `exports: 'named'` to make that hold
(`vite.config.ts`). A change that breaks `JSON`-compat or one import style is a
breaking change and needs an owner decision + CHANGELOG entry.

### 9. Commit boundaries match logical units
One commit per coherent change with a coherent message. Byte mode itself landed
as phased units (skeleton+table → byte serializer → byte parser → fuzz → docs).
Follow that grain: don't mix a grammar fix and a perf refactor in one commit.
Never commit unless asked (MANDATORY RULE #3).

**No hard wraps in commit messages or the CHANGELOG.** Write each paragraph or
bullet as a single soft-wrapped line; never insert newlines mid-paragraph to hit
a column width (the README and CHANGELOG are deliberately unwrapped, and commit
bodies follow the same rule). Newlines stay meaningful — blank lines between
paragraphs, one line per bullet — not a function of terminal width.

### 10. Documentation, comments, and naming
- Block comments use `/* … */`; reserve `//` for genuine one-liners. (Most of the
  codebase already uses `/* */` for multi-line intent comments — match it.)
- Comments explain **intent, trade-offs, and invariants**, not the mechanics the
  code already shows. The good comments in this repo (e.g. the `ignoreBOM`
  rationale at `src/raw.ts:24`, the surrogate-pair handling note in
  `ByteSink.codePoint`) are the model.
- No AI-isms ("Note that…", "It is important to…", "This is essential
  because…" as filler). No comment that narrates the diff ("now we also handle…").
- **Never reference an ADR number, a review-report finding ID, or a convention
  number from inside source code.** Those live in docs;
  source comments must stand on their own. (Reviewers flag these; the
  comment-hygiene pass scrubs them.)
- Names read as what they are: booleans read true/false (`preEscaped`, not
  `escapeState`), functions are verbs (`decodeUtf8`, `walkString`), American
  spelling. One-letter names only for trivial loop indices and the established
  byte-scanning locals (`b`, `cp`, `i`) that match the existing idiom.

### 11. Surface options, never silently pick
When a task has more than one reasonable approach with a real trade-off (a grammar
ambiguity, a perf-vs-clarity refactor, adding a dependency, a behavior that JSON5
and the JSON spec disagree on), **surface the options to the owner with a
recommendation** rather than picking unilaterally. The ADRs are the canonical
example — they lay out the options with verdicts instead of just recording the
winner. Security-relevant defaults (what to do with a lone surrogate, whether
to throw or replace) are never an agent's silent call.

### 12. Verify latest stable + cross-compat before pinning/bumping a dependency
All deps are dev-only, but a major bump to `vite`/`vitest`/`typescript`/
`dts-bundle-generator` can change the build or the type bundle. Check the current
stable and that the lockstep still holds (vitest ↔ its coverage provider; the
TypeScript version ↔ `dts-bundle-generator` support) before bumping. Note any
intentional pin in the commit message.

### 13. Preserve full user visibility on every command
The long-form of MANDATORY RULE #1: never filter, never silent-redirect, use
`tee` + `pipefail` when you also need a copy. Applies to test, lint, build, and
benchmark runs alike.

### 14. ADRs are the *why*, not a license to rationalize
`docs/adr/` records why each load-bearing decision was made and what was rejected.
Read them to orient yourself. An ADR is a **record of a decision, not a verdict on
it**: it is not proof the decision is correct, and not proof the decision is
permanent. ADRs can be wrong, can rest on a premise that has since changed, and
get **superseded** — only the MANDATORY RULES and the frozen string paths (#5) are
genuine hard constraints; everything an ADR merely records is revisitable. When
*reviewing* code, do **not** treat an ADR as proof a decision is correct — a smell
is a finding even if an ADR explains it; and if you believe the *decision itself*
is wrong, raise it as a decision-level finding to the owner rather than deferring
to the ADR (see `.reviewer/README.md`, "An ADR is a record, not a verdict"). When
*implementing*, if you contradict an ADR, that's a decision to surface, and the ADR
gets a superseding entry.

---

## Byte-mode security invariants (the load-bearing part)

This section is the operational summary of `docs/byte-mode-heap-hygiene.md`. If
you edit `raw.ts`, `bytes.ts`, `parseBytes.ts`, or `stringifyBytes.ts`, hold every
one of these and re-run `npm run test:heap`.

The property, for a chosen secret **value** in `{"subkey":"<secret>", …}` parsed
from bytes:

- **X — never created.** The secret is never decoded into a JS `String`, not even
  transiently.
- **Y — never lingers.** After the call, no reachable `String` retains the secret;
  the only live plaintext copies are byte buffers the caller owns and can zero.
- **Z — structurally provable.** `span()` returns a `subarray` view aliasing the
  caller's input (zero-copy); `decode()`/`copy()` return `Uint8Array`s produced by
  byte writes only.

The single structural fact everything rests on: **bytes cannot become a `String`
without `String.fromCharCode` / `String.fromCodePoint` / `TextDecoder.decode` /
`Buffer.prototype.toString` (or `*Slice`) / `String(…)`.** Byte mode concentrates
*all* of those into one class — `StringSink` (`src/raw.ts:66-78`) — and the secret
value path never instantiates it. `ByteSink` and `NULL_SINK` construct no
`String`; `walkString`/`handleEscape`/`ByteWriter`/`decodeUtf8` are numeric-only.
`StringSink` is built only outside the value path — `scanStringForParse(collect=true)`
(keys / `raw:'off'`) and the two deliberate hatches
`RawString.unsafeDecodeToString()` and `unsafeEncodeAsJSON`'s `rawValueToString` —
and **none is on the value path** (value tokens parse with `collect=false`, storing
a `RawString`; keys/structure use the decoding path and are not secrets).

Operational rules that keep X/Y/Z true:

- **Scope is values only.** Object keys are always JS strings (JS requires it), so
  `raw:'all'` aliases `raw:'values'`. A secret must be a value, not a key. Don't
  "fix" `raw:'all'` to stringify-free keys; it's impossible by JS semantics, and
  the docs say so.
- **No `String` on the value path.** Any new code reachable from
  `scanStringToken(..., collect=false)`, `RawString.span/copy/decode`, or the byte
  serializer's `RawString`/`RawValue` handling must be byte-only. If you need a
  string there, you've made a mistake.
- **No value bytes in messages** (Convention #6).
- **`unsafeDecodeToString()`/`unsafeEncodeAsJSON()` are the only hatches, and the
  surface fails closed** — `toString`/`Symbol.toPrimitive`/`valueOf`/`toJSON`
  redact or throw (Convention #7).
- **Caller owns buffer lifetime.** `span()` aliases the input; document and
  preserve that the caller must copy/`decode()` before zeroing the input, and that
  `ByteWriter.toUint8Array()` returns a right-sized *copy* so the internal
  (possibly over-allocated) backing store is never aliased out.
- **Keep the proof current.** If you change the set of byte→`String` entry points,
  the value path, or the sink structure, update `docs/byte-mode-heap-hygiene.md`
  (it cites specific line ranges) and the heap test's spy list in the same change.

---

## File / directory map

```
src/
  index.ts            Public entry: re-exports parse, stringify, RawString, RawValue
                        (named) + a default-export object binding the same.
  parse.ts            String parser — inherited JSON5 lexer/parser state machine
                        (~1100 lines, one closure). FROZEN for byte work. Dispatches
                        Uint8Array input and raw mode to parseBytes.
  stringify.ts        String serializer — inherited JSON5 serializer. FROZEN for
                        byte work. Dispatches raw:true to serializeToBytes.
  parseBytes.ts       Byte parser — a faithful port of parse.ts's state machine over
                        a Uint8Array; returns RawString spans for values in raw mode.
                        Internal (reached via parse()).
  stringifyBytes.ts   Byte serializer — mirrors stringify.ts structure; injects
                        RawValue/RawString bytes; returns Uint8Array. Internal.
  raw.ts              RawString / RawValue, the shared escape engine (walkString,
                        handleEscape), the Sink interface (StringSink/ByteSink/
                        NULL_SINK), JSON11ByteError. The heart of byte mode.
  bytes.ts            ByteWriter (growable Uint8Array) + decodeUtf8 (strict,
                        bounds-checked). Numeric byte primitives only.
  escapes.ts          Shared escape tables (quote replacements, control escapes,
                        legacy-escape handling). Single source of truth for escaping.
  serializeShared.ts  Leaf string/key serialization shared by both serializers
                        (quoteString, serializeKey, QuoteContext).
  unicode.ts          GENERATED Unicode property tables (ID_Start, ID_Continue,
                        Space_Separator). Regenerate via `npm run generate-unicode`.
  util.ts             Char-class predicates over strings (isIdStartChar, isDigit,
                        isHexDigit, isHex, isInteger, …) used by both parsers.
  cli.ts              The `json11` CLI (convert/validate/space/out-file). Uses the
                        STRING parse path. Excluded from coverage.
  register.cjs        Require-hook helper.
  register.mjs        Import-hook helper.

test/
  _helpers.ts         Shared scaffolding (PRNG, generators, materialize). NOT a test.
  parse.test.ts       String parser spec tests.
  stringify.test.ts   String serializer spec tests.
  raw.test.ts         RawString/RawValue unit tests.
  byteParse.test.ts   Differential: byte parse ≡ string parse.
  byteStringify.test.ts  Differential: byte serialize ≡ UTF-8 of string serialize.
  adversarial.test.ts Hostile-input typed-error / no-crash tests.
  fuzz.test.ts        Seeded-random differential + hostile fuzzing.
  heapHygiene.test.ts No-String guarantee (run with `npm run test:heap`).
  byteMode.bench.ts   Byte-mode benchmarks.

docs/
  byte-mode-heap-hygiene.md   The proof behind the no-String guarantee.
  adr/                        Architecture Decision Records (see docs/adr/README.md).

build/
  unicode.js          Generator for src/unicode.ts.

.reviewer/            Review prompts + orchestration manual (see .reviewer/README.md).
.review/              (gitignored) Per-run review/fix outputs. Not source.

README.md / CHANGELOG.md / CONTRIBUTING.md / SECURITY.md / LICENSE.md
vite.config.ts        Build (umd/cjs/es + cli + minified) and coverage config.
eslint.config.mjs     Lint (currently @eslint/js recommended only — see gotcha #2).
tsconfig.json         strict, ES2022, noEmitOnError. rootDir src, used by build:type.
package.json          Scripts, exports map, dev deps.
```

---

## Useful one-liners

```bash
# Full suite + heap suite, both teed
set -o pipefail; npm test 2>&1 | tee /tmp/json11-test.log; echo "EXIT=$?"
set -o pipefail; npm run test:heap 2>&1 | tee /tmp/json11-heap.log; echo "EXIT=$?"

# Run a single test file
npx vitest --run test/byteParse.test.ts

# Run one test by name
npx vitest --run -t "round-trips a single-quoted span"

# Coverage report (HTML lands in ./.coverage/)
npx vitest run --coverage

# Fast type-check without emitting
npx tsc --noEmit -p tsconfig.json

# Reproduce a fuzz failure once you have the seed (seeds print on failure)
npx vitest --run test/fuzz.test.ts
```

---

## Sandbox + environment pitfalls (will grow as we learn)

1. **`npm run test:heap` needs `--expose-gc`.** It's wired via `NODE_OPTIONS` in
   the script; if you run the file directly with `vitest` you must export
   `NODE_OPTIONS=--expose-gc` yourself or `global.gc` is undefined and the sweep
   silently degrades. The suite's positive control guards against a meaningless
   green, but run it through the npm script to be safe.
2. **Lint is shallow today.** `eslint.config.mjs` loads only `@eslint/js`
   recommended — there is **no `typescript-eslint`** in the chain. So `npm run
   lint` will *not* catch TypeScript-specific smells (unused type-only imports,
   `any` widening, missing exhaustiveness). The real type gate is
   `tsconfig.json`'s `strict` + `noUnusedLocals`/`noUnusedParameters`/
   `noFallthroughCasesInSwitch`, exercised by `build:type`/`tsc`. Don't assume a
   green lint means a green type-check; run both.
3. **The library logs to `console.warn`.** The parsers warn on a raw
   U+2028/U+2029 inside a string (`separatorChar`/`separatorWarn`) and on a BigInt
   `RangeError` under `withLongNumerals` (`newNumericToken`). This is real console
   output from a library call — it can surprise embedders and it shows up in test
   output. It's a known wart; if you touch those paths, don't *add* value content
   to the warning (Convention #6), and flag any expansion of console logging to
   the owner.
4. **`vitest` defaults to watch mode.** Always use `--run` (the npm scripts do).
   A backgrounded watcher left running will hold the terminal and re-fire on every
   file write.
5. **The d.ts bundle is the public-type contract.** `build:type` runs
   `dts-bundle-generator` with `--export-referenced-types` and
   `--umd-module-name=JSON11`. If you change an exported type's shape, rebuild and
   eyeball `dist/index.d.ts` — the bundle is what consumers see, and
   `skipLibCheck:false` means a type error there fails the build.

---

## When in doubt

- Read the actual failure output before hypothesizing (Convention/evidence rule).
  A failing differential test prints the diverging input; a failing fuzz test
  prints the seed; a parser error carries `line:column`; a byte error carries the
  byte offset. Reproduce the one failing case in isolation
  (`npx vitest --run -t "<name>"`) before guessing.
- If a byte-mode change tempts you to edit `parse.ts`/`stringify.ts`, stop
  (MANDATORY RULE #5).
- If a change could let a value become a `String`, stop and re-read
  `docs/byte-mode-heap-hygiene.md` (MANDATORY RULE #6).
- If two reasonable designs exist, surface both (Convention #11).

---

## Things to flag back to the user, not decide alone

- Adding any **runtime** dependency.
- Changing the **public API** shape, an overload, or `JSON`-compat behavior.
- Changing behavior on a **spec ambiguity** (lone surrogates, U+2028/2029,
  number/BigInt boundary, `withLegacyEscapes` defaults).
- Anything that could affect the **no-`String` guarantee** or weaken a heap test.
- Expanding **`console` logging** from the library.
- A **major dev-dependency bump** that changes the build or the type bundle.
- Dropping or weakening a **differential / fuzz / heap** test to make a change
  "pass".
