/* Low-level byte primitives shared by the byte parser and byte serializer.
 *
 * Nothing here ever constructs a JS String from value bytes; that is the whole
 * point of byte-mode. `ByteWriter` is a small growable Uint8Array, and the
 * helpers below decode/encode UTF-8 with strict bounds checking so hostile input
 * can never read out of bounds.
 */

/* A growable byte buffer. `toUint8Array` returns a right-sized copy so the
 * internal (possibly over-allocated) backing store is never aliased out.
 */
export class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(Math.max(16, initialCapacity));
  }

  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const needed = this.len + extra;
    if (needed <= this.buf.length) {
      return;
    }
    let next = this.buf.length * 2;
    while (next < needed) {
      next *= 2;
    }
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  pushByte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  /* Copy a verbatim run of bytes from `src[start, end)`. */
  pushBytes(src: Uint8Array, start = 0, end = src.length): void {
    const count = end - start;
    if (count <= 0) {
      return;
    }
    this.ensure(count);
    this.buf.set(src.subarray(start, end), this.len);
    this.len += count;
  }

  /* Insert `src` immediately before offset `at`, shifting the existing bytes
   * [at, len) to the right. The byte serializer uses this for an object member
   * whose key needs quoting: that key's quote choice depends on the quote
   * weights its *value* contributes, so the value must be serialized first
   * (appended here) yet appear after the key — the key is spliced in front once
   * known. Numeric only: it moves bytes, never constructs a String. */
  insertBefore(at: number, src: Uint8Array): void {
    const count = src.length;
    if (count <= 0) {
      return;
    }
    this.ensure(count);
    this.buf.copyWithin(at + count, at, this.len);
    this.buf.set(src, at);
    this.len += count;
  }

  /* Encode a single Unicode scalar value as UTF-8. Surrogate code points
   * (0xD800-0xDFFF) are emitted as U+FFFD because they have no valid UTF-8
   * encoding; surrogate *pairs* must be combined by the caller before reaching
   * here.
   */
  pushCodePoint(cp: number): void {
    if (cp < 0x80) {
      this.pushByte(cp);
    } else if (cp < 0x800) {
      this.ensure(2);
      this.buf[this.len++] = 0xc0 | (cp >> 6);
      this.buf[this.len++] = 0x80 | (cp & 0x3f);
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      this.pushReplacement();
    } else if (cp < 0x10000) {
      this.ensure(3);
      this.buf[this.len++] = 0xe0 | (cp >> 12);
      this.buf[this.len++] = 0x80 | ((cp >> 6) & 0x3f);
      this.buf[this.len++] = 0x80 | (cp & 0x3f);
    } else {
      this.ensure(4);
      this.buf[this.len++] = 0xf0 | (cp >> 18);
      this.buf[this.len++] = 0x80 | ((cp >> 12) & 0x3f);
      this.buf[this.len++] = 0x80 | ((cp >> 6) & 0x3f);
      this.buf[this.len++] = 0x80 | (cp & 0x3f);
    }
  }

  private pushReplacement(): void {
    this.ensure(3);
    this.buf[this.len++] = 0xef;
    this.buf[this.len++] = 0xbf;
    this.buf[this.len++] = 0xbd;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/* The number of bytes in the UTF-8 sequence whose lead byte is `b`, or 0 if `b`
 * is not a valid UTF-8 lead byte (continuation byte, or 0xF8-0xFF).
 */
export function utf8SequenceLength(b: number): number {
  if (b < 0x80) return 1;
  if (b < 0xc0) return 0; // continuation byte cannot start a sequence
  if (b < 0xe0) return 2;
  if (b < 0xf0) return 3;
  if (b < 0xf8) return 4;
  return 0;
}

export type DecodedCodePoint = { cp: number; size: number };

/* Strictly decode the UTF-8 sequence starting at `pos`, never reading at or past
 * `limit`. Returns the code point and its byte length, or null at end of input.
 * Throws RangeError on any malformed/overlong/out-of-range/surrogate sequence so
 * callers can convert it into a typed parse error.
 */
export function decodeUtf8(source: Uint8Array, pos: number, limit: number = source.length): DecodedCodePoint | null {
  if (pos >= limit) {
    return null;
  }

  const b0 = source[pos];
  const size = utf8SequenceLength(b0);
  if (size === 0) {
    throw new RangeError(`invalid UTF-8 lead byte at ${pos}`);
  }
  if (size === 1) {
    return { cp: b0, size: 1 };
  }
  if (pos + size > limit) {
    throw new RangeError(`truncated UTF-8 sequence at ${pos}`);
  }

  let cp: number;
  if (size === 2) {
    const b1 = source[pos + 1];
    if ((b1 & 0xc0) !== 0x80) throw new RangeError(`invalid UTF-8 continuation at ${pos + 1}`);
    cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
    if (cp < 0x80) throw new RangeError(`overlong UTF-8 sequence at ${pos}`);
  } else if (size === 3) {
    const b1 = source[pos + 1];
    const b2 = source[pos + 2];
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) {
      throw new RangeError(`invalid UTF-8 continuation at ${pos}`);
    }
    cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
    if (cp < 0x800) throw new RangeError(`overlong UTF-8 sequence at ${pos}`);
    if (cp >= 0xd800 && cp <= 0xdfff) throw new RangeError(`UTF-8 encoded surrogate at ${pos}`);
  } else {
    const b1 = source[pos + 1];
    const b2 = source[pos + 2];
    const b3 = source[pos + 3];
    if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
      throw new RangeError(`invalid UTF-8 continuation at ${pos}`);
    }
    cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    if (cp < 0x10000 || cp > 0x10ffff) throw new RangeError(`out-of-range UTF-8 sequence at ${pos}`);
  }

  return { cp, size };
}
