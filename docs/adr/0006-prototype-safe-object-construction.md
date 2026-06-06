# 0006. Prototype-safe object construction via `Object.defineProperty`

**Status:** Accepted (2026-06-05)
**Implementation:** Implemented (`src/parse.ts`, `src/parseBytes.ts`)

- Related: [0007 — Hostile-input posture](./0007-hostile-input-typed-errors.md)

## Context

A JSON parser builds objects from attacker-controllable keys. The two classic
hazards are **prototype pollution** (an input key `__proto__` mutating
`Object.prototype` for the whole process) and **setter hijack** (a key that
matches an inherited accessor running attacker-influenced code or silently
dropping the value). Plain assignment — `parent[key] = value` — is vulnerable to
both: `parent['__proto__'] = {...}` walks the prototype, and a key matching a
defined setter invokes it.

## Decision

Every parsed property is installed with `Object.defineProperty(parent, key,
{ value, writable: true, enumerable: true, configurable: true })`, never with
`parent[key] = value` (`src/parse.ts:1012`, `src/parseBytes.ts:881`). The
reviver's `internalize` uses the same `defineProperty` for replacements
(`src/parse.ts:761`, `src/parseBytes.ts:693`). `defineProperty` creates an own
data property directly, bypassing the prototype chain and any inherited setter, so
a `__proto__` key becomes an ordinary own property of the parsed object and cannot
pollute the prototype.

## Alternatives considered

- **Plain assignment + a `__proto__` blocklist.** Rejected: a blocklist is
  fragile (misses `constructor.prototype` style vectors and any future accessor
  key) and still runs inherited setters for non-blocklisted keys. `defineProperty`
  closes the whole class structurally.
- **`Object.create(null)` for every parsed object.** Rejected: it changes the
  prototype of returned objects (no `Object` methods, different
  `JSON.stringify`/equality behavior), breaking JSON-compat (ADR 0009). The
  consumer expects ordinary objects; `defineProperty` gives them that, safely.

## Consequences

- **`AGENTS.md` Convention #4** marks a plain `parent[key] = value` on an
  object-building path as a security finding.
- Both parsers (string and byte) must keep this on every push/internalize path;
  the byte parser additionally guards the recursion with
  `!(value instanceof RawString)` so a borrowed span is never walked as an object.
- Returned objects are ordinary (prototype intact), preserving JSON-compatible
  behavior.
