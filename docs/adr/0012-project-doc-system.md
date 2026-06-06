# 0012. Project doc system: AGENTS / ADRs / heap-hygiene proof

**Status:** Accepted (2026-06-05)
**Implementation:** In force (`AGENTS.md`, `docs/adr/`, `docs/byte-mode-heap-hygiene.md`)

- Related: [0005 — No-`String` guarantee](./0005-no-string-guarantee.md), [0010 — Test strategy](./0010-test-strategy-differential-fuzz-heap.md)

## Context

JSON11 carries an unusual amount of *why* for a small library: a duplicated byte
grammar that must not drift, a by-construction escape-consistency claim, and a
security guarantee about secrets. That knowledge has to outlive any one
contributor or chat session, and it serves different readers (a working agent, a
maintainer making a decision, a security reviewer checking a claim). One giant
README would serve none of them well.

## Decision

Three documents with distinct, non-overlapping jobs:

- **`AGENTS.md`** — *how to work in the repo*: mandatory rules, conventions, test
  discipline, the byte-mode security invariants in operational form, the file map,
  and the gotchas. The first thing a working agent reads.
- **`docs/adr/`** — *why the load-bearing decisions were made and what was
  rejected*. Durable, numbered, append-only. Read to orient, not to rationalize
  (a reviewer flags a smell even when an ADR explains it).
- **`docs/byte-mode-heap-hygiene.md`** — the *proof* behind the no-`String`
  guarantee, primary over the heap tests. Read before touching any byte-mode value
  path.

A separate `.reviewer/` directory holds the review-prompt + orchestration system,
with `.review/` (gitignored) for per-run outputs.

## Alternatives considered

- **Everything in the README.** Rejected: the README is the consumer-facing API
  doc; burying mandatory agent rules and a security proof in it serves neither the
  consumer nor the contributor.
- **A single CONTRIBUTING.md instead of AGENTS + ADRs.** Rejected: CONTRIBUTING is
  the human onboarding pointer; the operational rules (for agents and humans) and
  the decision history have different lifecycles and readers, and the ADR
  append-only history is worth keeping distinct from "how to contribute".

## Consequences

- New load-bearing decisions get an ADR; new operational rules/conventions get an
  `AGENTS.md` entry; the two cross-reference but don't duplicate.
- **Source comments must never cite an ADR number, a review finding, or a
  convention number** (`AGENTS.md` Convention #10) — that
  coupling rots and is scrubbed by the comment-hygiene pass.
- When the byte-mode value path, sink structure, or escape semantics change, the
  proof doc and the relevant ADR update in the same change as the code.
