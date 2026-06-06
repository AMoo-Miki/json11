# 0010. Test strategy: differential + fuzz + heap-hygiene tiers; coverage ungated

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`test/`, `vite.config.ts`)

- Related: [0002 — Byte mode as a parallel module](./0002-byte-mode-parallel-module.md), [0005 — No-`String` guarantee](./0005-no-string-guarantee.md), [0007 — Hostile-input posture](./0007-hostile-input-typed-errors.md)

## Context

Byte mode duplicates the JSON11 grammar over bytes (ADR 0002) and makes a
security claim about secrets never becoming `String`s (ADR 0005). Neither claim is
checkable by the type system or a runtime assertion — the tests *are* the proof.
A conventional "unit tests + a coverage threshold" posture would not catch the two
failure modes that actually matter here: the byte grammar drifting from the string
grammar, and a secret leaking into a `String`. Line coverage is especially
misleading: a happy-path test can drive coverage high while proving nothing about
grammar fidelity or secret safety.

## Decision

Adopt purpose-built test tiers, each defending a distinct property:

- **Spec / behavior** (`parse.test.ts`, `stringify.test.ts`, `raw.test.ts`) —
  the grammar and documented API directly.
- **Differential** (`byteParse.test.ts`, `byteStringify.test.ts`) — proves the
  byte path agrees with the string path (`parse(Buffer.from(s)) ≡ parse(s)`; byte
  serialize ≡ UTF-8 of string serialize for raw-node-free values). This is the
  *only* thing keeping the duplicated byte grammar from drifting.
- **Adversarial / fuzz** (`adversarial.test.ts`, `fuzz.test.ts`) — hostile bytes,
  typed-error/no-crash (ADR 0007). Fuzz uses the deterministic `mulberry32` PRNG
  in `test/_helpers.ts`; failures are reproducible by seed.
- **Heap hygiene** (`heapHygiene.test.ts`, run via `npm run test:heap` with
  `--expose-gc`) — the no-`String` guarantee (ADR 0005), with an in-suite positive
  control so a green "not found" is meaningful.
- **Bench** (`byteMode.bench.ts`) — a regression watch, not a gate.

**Coverage is wired but ungated.** Istanbul coverage is configured in
`vite.config.ts` (`reportsDirectory: ./.coverage`, `include: src/**/*.ts`,
`exclude: src/cli.ts`), but there is no threshold check and no CI failing on a
coverage drop. The differential/fuzz/heap tiers are the quality signal, not a
coverage number.

## Alternatives considered

- **A coverage-threshold gate (e.g. flat 90%).** Deferred, not adopted: a number
  invites coverage-chasing tests that lift lines without strengthening the
  grammar/secret guarantees. If a gate is added later, it should sit *on top of*
  these tiers, not replace them, and exclude generated/CLI files. This is an
  owner decision (Convention #11).
- **Property-based testing library (fast-check, etc.).** Not adopted: the
  hand-rolled deterministic PRNG + curated corpus in `test/_helpers.ts` gives
  reproducible-by-seed fuzzing with zero added dependency (ADR 0001). Revisit only
  if the generators stop catching real drift.

## Consequences

- **`AGENTS.md`** documents the categories and the rule for which tier a test
  belongs in; a behavior change ships with the tier test that proves it, and a bug
  fix ships with the regression test that would have caught it.
- Dropping or weakening a differential/fuzz/heap test to make a change "pass" is
  banned (a thing to flag to the user, not decide).
- When a fuzz case fails, capture the seed it prints; reproduce in isolation
  before hypothesizing.
