# 0001. Dependency-free TypeScript library; multi-format (ESM/CJS/UMD) build

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`package.json`, `vite.config.ts`)

- Related: [0009 — JSON-compatible API + import styles](./0009-json-compatible-api-and-import-styles.md)

## Context

JSON11 is a low-level, broadly-embedded utility: it gets pulled into browsers,
Node services, build tools, and security-sensitive code paths. Two forces follow
from that:

- **Trust surface must stay tiny.** Every runtime dependency is code a consumer
  now trusts transitively in a parser they often feed untrusted input to. A
  supply-chain compromise of a dep is a compromise of everyone parsing with
  JSON11.
- **Consumers live in every module system.** Some use ESM, some CommonJS, some a
  `<script>` tag with a global. A JSON-replacement library that only ships one
  format forces a build step on half its users.

## Decision

- **Zero runtime dependencies.** `package.json` carries only `devDependencies`.
  Byte mode — the largest feature added — introduced no runtime deps and relies
  only on platform built-ins (`TextEncoder`/`TextDecoder`, `Uint8Array`,
  `BigInt`).
- **Ship ESM, CJS, and UMD** from one source via Vite library mode
  (`formats: ['umd', 'cjs', 'es']`), plus a separate minified build
  (`MINIFY=true`), a CLI build, and a bundled `.d.ts` produced by
  `dts-bundle-generator`. The `exports`/`main`/`browser`/`types` fields in
  `package.json` route each consumer to the right artifact.
- **Pure TypeScript, no platform-specific runtime APIs** beyond the built-ins
  above, so the same source serves browser and Node.

## Alternatives considered

- **Allow small, well-known runtime deps** (e.g. a unicode-property package at
  runtime). Rejected: the Unicode tables are generated *at build time* into
  `src/unicode.ts` (`npm run generate-unicode`), so the data ships inlined with no
  runtime cost or trust expansion.
- **ESM-only.** Rejected: strands CJS and `<script>`-tag consumers; JSON11 is a
  drop-in for the global `JSON`, which is available everywhere, so the library
  should be too.
- **Hand-rolled or Rollup-direct build.** Vite library mode already wraps Rollup
  with the multi-format output and terser integration we need; no reason to
  reimplement it.

## Consequences

- A proposal to add a runtime dependency is a Convention #11 decision for the
  owner, never an agent's silent call (`AGENTS.md`).
- The build has several outputs that must all stay green
  (`build:lib`/`build:cli`/`build:mini`/`build:type`); `prepublishOnly` runs the
  full gate (`npm i && test && lint && build`).
- `skipLibCheck: false` means the d.ts bundle step genuinely type-checks the
  public surface; a type error there fails the build (this is also the de-facto
  type-check, since lint is shallow — see ADR 0010 / `AGENTS.md` gotcha #2).
- Consumers get the same API through every import style (ADR 0009).
