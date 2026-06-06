/* Heap-hygiene proofs for the byte-mode VALUE path: the chosen secret string
 * value must never become a JS String (X), must not linger on the heap (Y), and
 * the value accessors must be byte-only (Z). See docs/byte-mode-heap-hygiene.md for
 * the primary (structural) argument; these tests are corroboration + regression
 * nets. Each test states which of X/Y/Z it defends and its limits.
 *
 * The motivating value path is: parse(bytes, …, { raw:'values' }) -> RawString,
 * then `.span()` (zero-copy view) / `.decode()` (fresh bytes), then re-inject via
 * RawValue into stringify(…, { raw:true }). `.unsafeDecodeToString()` (one value)
 * and `unsafeEncodeAsJSON(tree)` (a whole parsed tree) are the deliberately-named
 * opt-in hatches that DO create a String and must never touch a secret; every
 * implicit coercion and `JSON.stringify` now throws instead of materializing.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import { parse, stringify, RawValue, unsafeEncodeAsJSON } from '../src';
import { enc, makeRng, randString } from './_helpers';

// ---------- byte construction helpers (never build a String of a secret) ----------

function joinBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* A 32-byte ascii-hex secret built straight into bytes from CSPRNG output, so the
 * plaintext never exists as a JS String anywhere in the test. */
function makeSecretBytes(): Uint8Array {
  const rnd = crypto.randomBytes(16);
  const H = '0123456789abcdef';
  const out = new Uint8Array(32);
  for (let i = 0; i < 16; i++) {
    out[2 * i] = H.charCodeAt(rnd[i] >> 4);
    out[2 * i + 1] = H.charCodeAt(rnd[i] & 0x0f);
  }
  return out;
}

/* Wrap raw value bytes as the document {"k":"<value>"} — structural parts are
 * tiny constants, the secret is spliced in as bytes. */
function docWith(valueInner: Uint8Array): Uint8Array {
  return joinBytes([enc('{"k":"'), valueInner, enc('"}')]);
}

// ---------- Test A: zero-copy aliasing (strongest automatic signal for X/Z, span path) ----------

describe('A — zero-copy aliasing of the input (no String copy was made)', () => {
  it('span() is a live view of the caller buffer; mutating the source changes it [X/Z]', () => {
    const input = Buffer.from('{"k":"SENTINEL_BYTES"}', 'utf8');
    const doc: any = parse(input, null, { raw: 'values' });
    const view = doc.k.span();

    expect(view).toBeInstanceOf(Uint8Array);
    expect(typeof view).not.toBe('string');
    // shares the same backing store as the input — i.e. it was never copied out
    expect(view.buffer).toBe(input.buffer);

    const at = input.indexOf(0x53 /* 'S' */);
    input.fill(0, at, at + 'SENTINEL_BYTES'.length);
    expect(Array.from(view).every((b) => b === 0)).toBe(true); // the view reflects the zeroing
  });

  it('decode() returns a Uint8Array (never a string) that the caller can zero [X/Z]', () => {
    const doc: any = parse(docWith(makeSecretBytes()), null, { raw: 'values' });
    const decoded = doc.k.decode();
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(typeof decoded).not.toBe('string');
    decoded.fill(0);
    expect(decoded.every((b) => b === 0)).toBe(true);
  });
});

// ---------- Test B: primitive spies (regression net for X), strengthened vs char-by-char ----------

/* Every way to turn bytes into a JS String funnels through one of these. */
function installCountingSpies() {
  const calls: string[] = [];
  const saved: Array<[any, string, any]> = [];
  const wrap = (obj: any, key: string) => {
    if (!obj || typeof obj[key] !== 'function') return;
    const orig = obj[key];
    saved.push([obj, key, orig]);
    obj[key] = function (...a: any[]) {
      calls.push(key);
      return orig.apply(this, a);
    };
  };
  wrap(String, 'fromCharCode');
  wrap(String, 'fromCodePoint');
  // The invariant (docs/byte-mode-heap-hygiene.md) names the global String(…) as
  // a byte→String entry point, so spy it too. The value accessors are numeric-only
  // and never call it; if a future regression routes value bytes through String(…)
  // this catches it. The wrapper itself calls only push/apply, so it can't recurse.
  wrap(globalThis as any, 'String');
  wrap((globalThis as any).TextDecoder.prototype, 'decode');
  for (const m of ['toString', 'utf8Slice', 'latin1Slice', 'asciiSlice', 'ucs2Slice', 'hexSlice']) {
    wrap(Buffer.prototype as any, m);
  }
  return {
    calls,
    restore() {
      for (const [obj, key, orig] of saved) obj[key] = orig;
    },
  };
}

/* Records the numeric arguments handed to fromCharCode/fromCodePoint, so we can
 * prove specific value code points never get stringified even one char at a time. */
function installArgRecordingSpies() {
  const args: number[] = [];
  const saved: Array<[any, string, any]> = [];
  const wrap = (obj: any, key: string) => {
    const orig = obj[key];
    saved.push([obj, key, orig]);
    obj[key] = function (...a: any[]) {
      for (const x of a) if (typeof x === 'number') args.push(x);
      return orig.apply(this, a);
    };
  };
  wrap(String, 'fromCharCode');
  wrap(String, 'fromCodePoint');
  return {
    args,
    restore() {
      for (const [obj, key, orig] of saved) obj[key] = orig;
    },
  };
}

describe('B — byte→String primitives are never used on the value', () => {
  it('B1: span()/decode() call ZERO byte→String primitives (defeats char-by-char) [X/Z]', () => {
    // A value that exercises decode fully: ascii, \u escape, \n, raw multibyte,
    // surrogate-pair escape, and a raw astral emoji.
    const value = joinBytes([
      enc('a\\u0041\\n'),
      enc('\u00e9'),
      enc('\\uD83D\\uDE00'),
      enc('\u{1F4A9}'),
    ]);
    // Parse OUTSIDE the spy (parsing legitimately stringifies structure/keys).
    const doc: any = parse(docWith(value), null, { raw: 'values' });

    const spy = installCountingSpies();
    try {
      const view = doc.k.span();
      const decoded = doc.k.decode();
      void view;
      void decoded;
    } finally {
      spy.restore();
    }
    // The accessors are pure byte ops: any String primitive here is a regression.
    // This catches char-by-char (fromCharCode per byte), ConsString ropes, and
    // TextDecoder alike, because bytes cannot become a string without one of them.
    expect(spy.calls).toEqual([]);
  });

  it('B2: value code points never reach fromCodePoint/fromCharCode during a raw parse [X]', () => {
    // Distinctive PUA code points (BMP U+E007 and astral U+10FFFD), present both
    // as \u escapes and as raw UTF-8, so any char-wise decode of the value would
    // surface them (or the astral surrogate halves) as a stringify argument.
    const value = joinBytes([
      enc('\\uE007'),
      enc('\u{E007}'),
      enc('\\uDBFF\\uDFFD'),
      enc('\u{10FFFD}'),
    ]);
    const input = docWith(value);

    const spy = installArgRecordingSpies();
    try {
      const doc: any = parse(input, null, { raw: 'values' });
      doc.k.decode(); // exercise decode under the probe too
    } finally {
      spy.restore();
    }
    expect(spy.args).not.toContain(0xe007); // BMP value char
    expect(spy.args).not.toContain(0x10fffd); // astral value char (fromCodePoint)
    expect(spy.args).not.toContain(0xdbff); // its high surrogate (fromCharCode)
    expect(spy.args).not.toContain(0xdffd); // its low surrogate (fromCharCode)
  });

  it('B3: no flat String of the secret via Buffer.toString / TextDecoder.decode [X]', () => {
    // Original-style substring net across the FULL path (parse+decode+reinject).
    // Limit: cannot see a char-by-char build; B1/B2 cover that. Defended here:
    // an accidental TextDecoder/Buffer.toString of the whole value.
    const secret = makeSecretBytes();
    const needle = Buffer.from(secret).toString('latin1'); // a String of the secret, used only as the spy's reference
    const hits: string[] = [];
    const saved: Array<[any, string, any]> = [];
    const wrap = (obj: any, key: string) => {
      if (!obj || typeof obj[key] !== 'function') return;
      const orig = obj[key];
      saved.push([obj, key, orig]);
      obj[key] = function (...a: any[]) {
        const out = orig.apply(this, a);
        if (typeof out === 'string' && out.includes(needle)) hits.push(key);
        return out;
      };
    };
    try {
      wrap(Buffer.prototype as any, 'toString');
      wrap((globalThis as any).TextDecoder.prototype, 'decode');
      const input = docWith(secret);
      const doc: any = parse(input, null, { raw: 'values' });
      doc.k.span();
      doc.k.decode();
      stringify({ moved: RawValue.escaped(doc.k.span(), doc.k.quote) }, { raw: true });
    } finally {
      for (const [obj, key, orig] of saved) obj[key] = orig;
    }
    expect(hits).toEqual([]);
  });
});

// ---------- Test C: heap-snapshot sweep — the real check for Y ----------

/* getHeapSnapshot() runs a GC then captures only the reachable graph. So this is
 * a strong check for Y (nothing retains the secret after the call) and only a
 * weak check for X (a transient String would be GC'd before capture). Caveats:
 *  - 'concatenated string'/'sliced string' node *names* may not carry full
 *    content, so a rope-built secret could be missed here — that's why the
 *    structural argument and Test B are primary.
 *  - long string names can be truncated; the secret is kept short (32 bytes).
 * Snapshot field layout verified for this Node build (see docs/byte-mode-heap-hygiene.md).
 */
async function reachableSecretString(secretBytes: Uint8Array): Promise<boolean> {
  const chunks: Buffer[] = [];
  for await (const c of v8.getHeapSnapshot()) chunks.push(Buffer.from(c));
  const snap = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const meta = snap.snapshot.meta;
  const fieldCount = meta.node_fields.length;
  const typeIdx = meta.node_fields.indexOf('type');
  const nameIdx = meta.node_fields.indexOf('name');
  const typeNames: string[] = meta.node_types[typeIdx];
  // Build the search needle from bytes AFTER the snapshot is captured, so it can
  // never pollute the very snapshot we are inspecting.
  const needle = Buffer.from(secretBytes).toString('latin1');
  const nodes = snap.nodes;
  const strings = snap.strings;
  for (let i = 0; i < nodes.length; i += fieldCount) {
    const type = typeNames[nodes[i + typeIdx]];
    if (typeof type === 'string' && type.includes('string')) {
      const name = strings[nodes[i + nameIdx]];
      if (name && name.includes(needle)) return true;
    }
  }
  return false;
}

describe('C — no lingering String of the secret on the heap', () => {
  it('finds NO reachable secret String, retained or dropped [Y] (+corroborates X)', async () => {
    const secret = makeSecretBytes();

    let input: Uint8Array | null = docWith(secret);
    let doc: any = parse(input, null, { raw: 'values' });
    let out: Uint8Array | null =
      stringify({ moved: RawValue.escaped(doc.k.span(), doc.k.quote) }, { raw: true }) as Uint8Array;
    let decoded: Uint8Array | null = doc.k.decode();

    // Phase 1: even with the whole parse tree + outputs retained, the secret
    // exists only as bytes (RawString/Uint8Array), never as a String.
    global.gc?.();
    expect(await reachableSecretString(secret)).toBe(false);

    // Phase 2: drop and zero everything we own; nothing should retain the secret.
    input!.fill(0);
    out!.fill(0);
    decoded!.fill(0);
    input = out = decoded = null;
    doc = null;
    global.gc?.();
    global.gc?.();
    expect(await reachableSecretString(secret)).toBe(false);
  });

  it('positive control: the sweep DOES find a secret materialized via unsafeDecodeToString() [methodology check]', async () => {
    const secret = makeSecretBytes();
    const doc: any = parse(docWith(secret), null, { raw: 'values' });
    const leaked = doc.k.unsafeDecodeToString(); // the explicit hatch -> a real String of the secret
    global.gc?.();
    expect(await reachableSecretString(secret)).toBe(true);
    expect(leaked.length).toBe(32); // keep `leaked` reachable through the assertion
  });

  it('positive control: the sweep DOES find a secret materialized via unsafeEncodeAsJSON() [methodology check]', async () => {
    const secret = makeSecretBytes();
    const doc: any = parse(docWith(secret), null, { raw: 'values' });
    const leaked: any = unsafeEncodeAsJSON(doc); // the deliberate whole-tree JSON opt-in
    global.gc?.();
    expect(await reachableSecretString(secret)).toBe(true);
    expect(leaked.k.length).toBe(32); // keep the materialized tree reachable through the assertion
  });
});

// ---------- Test E: fail-closed surface — coercion / JSON throw, hatches trip the spy ----------

describe('E — the no-String surface fails closed and the hatches are the only doors', () => {
  it('JSON.stringify / implicit coercion throw for a raw-parsed value (never leak) [X]', () => {
    const doc: any = parse(docWith(makeSecretBytes()), null, { raw: 'values' });
    expect(Object.keys(doc.k)).not.toContain('source');
    expect(() => JSON.stringify(doc)).toThrow(TypeError);
    expect(() => `${doc.k}`).toThrow(TypeError);
    expect(() => String(doc.k)).toThrow(TypeError);
    // The byte-free placeholder reveals no value bytes.
    expect(doc.k.toString()).toMatch(/^\[RawString length=\d+\]$/);
  });

  it('unsafeDecodeToString() and unsafeEncodeAsJSON() route through a byte→String primitive [X-hatch]', () => {
    const doc: any = parse(docWith(makeSecretBytes()), null, { raw: 'values' });

    let spy = installCountingSpies();
    try {
      doc.k.unsafeDecodeToString();
    } finally {
      spy.restore();
    }
    expect(spy.calls.length).toBeGreaterThan(0);

    spy = installCountingSpies();
    try {
      unsafeEncodeAsJSON(doc);
    } finally {
      spy.restore();
    }
    expect(spy.calls.length).toBeGreaterThan(0);
  });
});

// ---------- Test D: correctness backstop (so "no String" isn't achieved by being wrong) ----------

describe('D — decoded value bytes are correct (no-String must not mean wrong)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => null);
  });
  afterAll(() => warn.mockRestore());

  const adversarial = [
    '',
    'plain',
    'a"b', "a'b", 'a\\b', 'a/b',
    '\b\f\n\r\t\v\0',
    'all\u0000\u0001\u0002\u001f controls',
    'caf\u00e9 \u4e2d\u6587 \u{1F600}\u{1F4A9}',
    '\uD800', '\uDFFF', 'lead\uD83Dtail', // lone surrogates -> U+FFFD on both paths
    'x'.repeat(2048),
    '\u2028\u2029 separators',
    'mixed \\u0041 \\x42 \\n raw\u00e9',
  ];

  it('decode() bytes equal the string-path value re-encoded, over an adversarial corpus [correctness]', () => {
    const check = (s: string) => {
      const text = `{"k":${JSON.stringify(s)}}`;
      const expected = enc((parse(text) as any).k); // string path, then re-encode to bytes
      const doc: any = parse(enc(text), null, { raw: 'values' });
      expect(Array.from(doc.k.decode())).toEqual(Array.from(expected));
    };
    for (const s of adversarial) check(s);

    const rng = makeRng(0x4321);
    for (let i = 0; i < 2000; i++) check(randString(rng, 40));
  });

  it('malformed value bytes throw a typed SyntaxError (never a partial/garbage value) [correctness]', () => {
    const bad = [
      '{"k":"\\uZZZZ"}',
      '{"k":"\\x1"}',
      '{"k":"unterminated}',
      '{"k":"raw\nnewline"}',
    ];
    for (const t of bad) expect(() => parse(enc(t), null, { raw: 'values' })).toThrow(SyntaxError);
    // malformed UTF-8 in the value
    expect(() =>
      parse(joinBytes([enc('{"k":"'), new Uint8Array([0xff, 0xfe]), enc('"}')]), null, { raw: 'values' }),
    ).toThrow(SyntaxError);
  });
});
