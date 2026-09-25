import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  CLIENT_SEED_PATTERN,
  createRoundRng,
  createSeededTestRng,
  hashServerSeed,
  hmacBlock,
  rngFromUint32Source,
  shuffleInPlace,
  uniformInt,
} from '../src/fair/rng.ts';

const SEEDS = {
  serverSeed: 'a'.repeat(64),
  clientSeed: 'giocatore',
  nonce: 0,
};

describe('hashServerSeed', () => {
  it('is the SHA-256 hex of the utf8 seed', () => {
    expect(hashServerSeed('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('createRoundRng', () => {
  it('reads big-endian uint32 values from consecutive HMAC blocks', () => {
    const rng = createRoundRng(SEEDS);
    const block0 = hmacBlock(SEEDS.serverSeed, SEEDS.clientSeed, 0, 0);
    const block1 = hmacBlock(SEEDS.serverSeed, SEEDS.clientSeed, 0, 1);
    const expected: number[] = [];
    for (const block of [block0, block1]) {
      for (let i = 0; i < 32; i += 4) {
        expected.push(Number.parseInt(bytesToHex(block.subarray(i, i + 4)), 16));
      }
    }
    const actual = Array.from({ length: 16 }, () => rng.nextUint32());
    expect(actual).toEqual(expected);
  });

  it('is deterministic for the same seeds and differs across nonces', () => {
    const a = createRoundRng(SEEDS);
    const b = createRoundRng(SEEDS);
    const c = createRoundRng({ ...SEEDS, nonce: 1 });
    const seqA = Array.from({ length: 20 }, () => a.int(37));
    const seqB = Array.from({ length: 20 }, () => b.int(37));
    const seqC = Array.from({ length: 20 }, () => c.int(37));
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('rejects invalid nonces', () => {
    expect(() => createRoundRng({ ...SEEDS, nonce: -1 })).toThrow(RangeError);
    expect(() => createRoundRng({ ...SEEDS, nonce: 1.5 })).toThrow(RangeError);
  });
});

describe('uniformInt', () => {
  it('rejects values at or above the largest multiple of n (no modulo bias)', () => {
    // 2^32 mod 37 = 7, so the limit is 2^32 - 7: values in [2^32 - 7, 2^32) are rejected.
    const values = [0xffff_ffff, 0xffff_fff9, 74];
    const source = () => values.shift()!;
    expect(uniformInt(source, 37)).toBe(0); // 74 % 37 after two rejections
    expect(values).toHaveLength(0);
  });

  it('accepts the value just below the limit', () => {
    const source = () => 0xffff_fff8; // 2^32 - 8 < 2^32 - 7
    expect(uniformInt(source, 37)).toBe(0xffff_fff8 % 37);
  });

  it('handles n = 1 and n = 2^32', () => {
    expect(uniformInt(() => 123, 1)).toBe(0);
    expect(uniformInt(() => 0xffff_ffff, 2 ** 32)).toBe(0xffff_ffff);
  });

  it('throws on invalid n', () => {
    expect(() => uniformInt(() => 0, 0)).toThrow(RangeError);
    expect(() => uniformInt(() => 0, 2.5)).toThrow(RangeError);
    expect(() => uniformInt(() => 0, 2 ** 32 + 1)).toThrow(RangeError);
  });

  it('always lands in [0, n)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 32 }),
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        (n, x) => {
          let first = true;
          // After one arbitrary value, fall back to 0 which is always accepted.
          const v = uniformInt(() => (first ? ((first = false), x) : 0), n);
          return v >= 0 && v < n;
        },
      ),
    );
  });

  it('is close to uniform over many HMAC draws (chi-square, 37 buckets)', () => {
    const rng = createRoundRng(SEEDS);
    const counts = new Array<number>(37).fill(0);
    const draws = 37_000;
    for (let i = 0; i < draws; i++) counts[rng.int(37)]!++;
    const expected = draws / 37;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // 36 degrees of freedom: p = 0.001 critical value is ~67.99. Deterministic for fixed seeds.
    expect(chi2).toBeLessThan(68);
  });
});

describe('shuffleInPlace', () => {
  it('produces a permutation of the input', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 60 }), fc.integer(), (items, seed) => {
        const shuffled = shuffleInPlace(createSeededTestRng(seed), [...items]);
        return (
          JSON.stringify([...shuffled].sort((a, b) => a - b)) ===
          JSON.stringify([...items].sort((a, b) => a - b))
        );
      }),
    );
  });

  it('follows Fisher-Yates from the last index down', () => {
    // Scripted source: every draw returns 0, so each position i swaps with index 0.
    const rng = rngFromUint32Source(() => 0);
    expect(shuffleInPlace(rng, [1, 2, 3, 4])).toEqual([2, 3, 4, 1]);
  });
});

describe('CLIENT_SEED_PATTERN', () => {
  it('accepts printable ASCII without colons, up to 64 chars', () => {
    expect(CLIENT_SEED_PATTERN.test('abc-123_XYZ')).toBe(true);
    expect(CLIENT_SEED_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(CLIENT_SEED_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(CLIENT_SEED_PATTERN.test('')).toBe(false);
    expect(CLIENT_SEED_PATTERN.test('a:b')).toBe(false);
    expect(CLIENT_SEED_PATTERN.test('con spazio')).toBe(false);
  });
});
