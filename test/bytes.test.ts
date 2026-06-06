import { expect, describe, it } from 'vitest';
import { ByteWriter } from '../src/bytes';

/* `insertBefore` is byte-serializer infra: it splices an object member's key in
 * front of its already-written value bytes (the value is serialized first so the
 * key's quote choice sees the value's quote weights). It must move the existing
 * tail right — including across a capacity grow — without dropping or corrupting
 * a byte. The byte≡string differential exercises it end to end; these pin the
 * primitive directly. */
describe('ByteWriter.insertBefore', () => {
  it('inserts in the middle, shifting the tail right', () => {
    const w = new ByteWriter();
    w.pushBytes(Uint8Array.from([1, 2, 5, 6]));
    w.insertBefore(2, Uint8Array.from([3, 4]));
    expect(Array.from(w.toUint8Array())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('inserts at the start and at the end', () => {
    const head = new ByteWriter();
    head.pushBytes(Uint8Array.from([9, 9]));
    head.insertBefore(0, Uint8Array.from([7, 8]));
    expect(Array.from(head.toUint8Array())).toEqual([7, 8, 9, 9]);

    const tail = new ByteWriter();
    tail.pushBytes(Uint8Array.from([1, 2]));
    tail.insertBefore(tail.length, Uint8Array.from([3, 4]));
    expect(Array.from(tail.toUint8Array())).toEqual([1, 2, 3, 4]);
  });

  it('is a no-op for an empty source', () => {
    const w = new ByteWriter();
    w.pushBytes(Uint8Array.from([1, 2, 3]));
    w.insertBefore(1, new Uint8Array(0));
    expect(Array.from(w.toUint8Array())).toEqual([1, 2, 3]);
  });

  it('preserves all bytes when the insert forces a capacity grow', () => {
    /* Fill near the small initial capacity, then insert enough to overflow it so
     * the grow + tail-move path runs; assert the full expected sequence. */
    const w = new ByteWriter(16);
    const base = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
    w.pushBytes(base);
    const ins = Uint8Array.from([100, 101, 102, 103, 104, 105, 106, 107]);
    w.insertBefore(8, ins);
    const expected = [
      ...base.slice(0, 8),
      ...ins,
      ...base.slice(8),
    ];
    expect(Array.from(w.toUint8Array())).toEqual(expected);
    expect(w.length).toBe(24);
  });
});
