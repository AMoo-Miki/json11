# 0011. Lone-surrogate decode policy (U+FFFD) and the U+2028/U+2029 warning

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/raw.ts`, `src/bytes.ts`, `src/parse.ts`, `src/parseBytes.ts`)

- Refines: [0005 — No-`String` guarantee](./0005-no-string-guarantee.md)

## Context

Two corners of the grammar behave differently between the string path and the byte
path, for reasons rooted in what each representation *can* hold:

- **Lone surrogates.** The string parser tolerates an escaped lone surrogate
  (`\uD800`) by keeping it in the JS string via `String.fromCodePoint` — a JS
  string can hold one. A `Uint8Array` of UTF-8 *cannot* represent a lone
  surrogate, and `Buffer.from(jsString,'utf8')` already replaces them with U+FFFD.
- **Line/paragraph separators.** A raw U+2028/U+2029 inside a string is valid
  JSON/JSON5 but is *not* valid ECMAScript (pre-ES2019), so JSON5 historically
  warned about it.

These both need a stated, non-silent policy (Convention #11) rather than whatever
falls out of the implementation.

## Decision

- **Lone surrogates on the byte decode path emit U+FFFD.** `ByteSink` combines a
  high+low surrogate escape pair into one astral code point; an unpaired surrogate
  is emitted as the U+FFFD replacement (`src/raw.ts` `ByteSink.codePoint`/
  `flushPending`, and `decodeUtf8` rejects UTF-8-encoded surrogates outright). The
  differential corpus is built by *encoding JS strings to UTF-8* and comparing, so
  lone surrogates can't smuggle a mismatch between the paths. (A future strict flag
  that throws instead of replacing remains a deliberate, opt-in choice — not a
  silent one.)
- **Raw U+2028/U+2029 inside a string triggers a fixed-text `console.warn`** in
  both parsers (`separatorChar` in `src/parse.ts`, `separatorWarn` in
  `src/parseBytes.ts` via `walkString`'s `onSeparator`). Critically, the byte
  parser's warning is a **fixed string with no value content**, so it does not
  leak the secret — it is a side effect *keyed on* content, not a content leak
  (`docs/byte-mode-heap-hygiene.md`).

## Alternatives considered

- **Throw on lone surrogates in byte mode.** Reasonable, and surfaced as a future
  strict-flag option; not the default because U+FFFD matches what
  `Buffer.from(...,'utf8')` does and keeps the byte path lossless-equivalent to the
  encode-then-compare differential model.
- **Drop the separator warning entirely.** Rejected for now: it preserves JSON5's
  long-standing ECMAScript-validity heads-up. But library `console` output is a
  real wart (`AGENTS.md` gotcha #3) — expanding it is a thing to flag, and a
  consumer who doesn't want it can escape/strip separators before parsing.

## Consequences

- The byte and string paths differ *intentionally* on lone surrogates; the
  differential test model (encode JS string → UTF-8 → compare) is built to make
  that difference invisible to the parity check rather than a false failure.
- Any move to change the lone-surrogate policy (e.g. adding the strict-throw flag)
  or to add/expand `console` output is a Convention #11 decision for the owner.
- A new error/warning message on the value path must still carry no value bytes
  (ADR 0005 / Convention #6).
