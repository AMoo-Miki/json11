# Architecture Decision Records

This directory holds JSON11's Architecture Decision Records (ADRs): durable,
tracked notes capturing the *why* behind a load-bearing design choice.

`README.md` and `CHANGELOG.md` describe what JSON11 does, but they don't survive
as a durable record of *why* a correctness- or security-relevant decision was made
and *what was rejected*.
ADRs do. When a decision shapes the grammar, the public API, the byte-mode trust
model, the escape semantics, or any other choice a future maintainer would
otherwise have to reverse-engineer, write it down here.

## Format

Each ADR is a numbered Markdown file, `NNNN-kebab-case-title.md`, following a
lightweight [MADR](https://adr.github.io/madr/)-style shape:

- **Title** — `# NNNN. Short imperative title`
- **Status** — the *decision* lifecycle: `Proposed` / `Accepted` /
  `Superseded by NNNN` / `Deprecated`, with the decision date.
- **Implementation** — the *build* state, kept distinct from Status because a
  decision can be accepted but not yet built. One of: `Implemented` /
  `In force` (a process/code convention, no single artifact) /
  `Partial — <what is and isn't built>` / `Not yet built (planned)`.
- **Relationship bullets** (optional) — link this ADR to others. Pick the verb
  precisely: **Supersedes / Superseded by** (fully replaces), **Amends / Amended
  by** (changes one provision), **Refines / Refined by** (sharpens without
  changing the decision), **Related** (cross-reference worth following). Cite the
  other ADR as a full Markdown link — `[NNNN — Title](./NNNN-slug.md)` — at first
  mention.
- **Context** — the forces at play: what problem, what constraints, what goals.
- **Decision** — what we chose, stated plainly, with enough mechanism that a
  reader can find it in the code.
- **Alternatives considered** — every viable option weighed, each with why it
  lost. This section is the point of the ADR; do not skip it.
- **Consequences** — what the decision buys, what it costs, what it locks in, and
  what follow-up it implies.

Numbers are stable ids assigned in this index's thematic order; a new ADR appends
at the next free number. The number never changes once assigned.

**A note for reviewers:** these records explain decisions; they do not bless them.
An ADR is a record of a decision, not proof it is correct or permanent — a decision
recorded here can be wrong, can rest on a premise that has since changed, and can be
superseded. A code reviewer judges the code on its merits (a smell is a finding even
when an ADR explains the decision behind it) and, if they believe the *decision
itself* is wrong, raises a **decision-level finding** to the owner rather than
treating the ADR as settled. See `.reviewer/README.md`, "An ADR is a record, not a
verdict".

## Index

### Foundation — language, packaging, build

- [0001 — Dependency-free TypeScript library; multi-format (ESM/CJS/UMD) build](./0001-dependency-free-multi-format-build.md)
- [0009 — JSON-compatible API surface + every import style binds the same exports](./0009-json-compatible-api-and-import-styles.md)

### Byte mode — the secret-handling layer

- [0002 — Byte mode as a parallel module, not a refactor of the string lexer](./0002-byte-mode-parallel-module.md)
- [0003 — Borrowed value spans: `RawString`/`RawValue`, `raw` folded into parse/stringify](./0003-borrowed-spans-raw-option.md)
- [0004 — One shared escape engine; lifted spans round-trip byte-identically](./0004-one-shared-escape-engine.md)
- [0005 — The no-`String` guarantee: `StringSink` confinement + structural proof](./0005-no-string-guarantee.md)
- [0013 — Fail-safe coercion: named `unsafe*` hatches replace `toString()`](./0013-fail-safe-coercion-no-string-surface.md)

### Grammar, numbers, and correctness posture

- [0006 — Prototype-safe object construction via `Object.defineProperty`](./0006-prototype-safe-object-construction.md)
- [0007 — Hostile-input posture: bounds-checked byte parser, typed errors](./0007-hostile-input-typed-errors.md)
- [0008 — BigInt parse/serialize (`withLongNumerals` / `withBigInt`)](./0008-bigint-support.md)
- [0011 — Lone-surrogate decode policy (U+FFFD) and the U+2028/U+2029 warning](./0011-lone-surrogate-and-separator-policy.md)

### Process / docs

- [0010 — Test strategy: differential + fuzz + heap-hygiene tiers; coverage ungated](./0010-test-strategy-differential-fuzz-heap.md)
- [0012 — Project doc system: AGENTS / ADRs / heap-hygiene proof](./0012-project-doc-system.md)
