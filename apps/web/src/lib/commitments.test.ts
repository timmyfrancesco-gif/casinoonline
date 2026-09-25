import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommitment, recordCommitment, recordRoundCommitment } from './commitments.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('seed commitments kept by the browser', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the first hash seen for a pair and never overwrites it', () => {
    recordCommitment('7', HASH_A, new Date('2026-09-25T10:00:00Z'));
    recordCommitment('7', HASH_B, new Date('2026-09-26T10:00:00Z'));
    expect(getCommitment('7')).toEqual({ hash: HASH_A, firstSeenAt: '2026-09-25T10:00:00.000Z' });
    expect(getCommitment('8')).toBeNull();
  });

  it('records a round only while its server seed is secret', () => {
    const fairness = { seedPairId: '3', serverSeedHash: HASH_A, clientSeed: 'c', nonce: 0 };
    recordRoundCommitment({ ...fairness, serverSeed: 'f'.repeat(64) });
    expect(getCommitment('3')).toBeNull();
    recordRoundCommitment({ ...fairness, serverSeed: null });
    expect(getCommitment('3')?.hash).toBe(HASH_A);
  });

  it('ignores malformed hashes and keeps at most 200 pairs, dropping the oldest', () => {
    recordCommitment('x', 'not-a-hash');
    expect(getCommitment('x')).toBeNull();
    for (let i = 0; i < 205; i++) {
      recordCommitment(String(i), HASH_A, new Date(Date.UTC(2026, 0, 1, 0, i)));
    }
    expect(getCommitment('0')).toBeNull();
    expect(getCommitment('4')).toBeNull();
    expect(getCommitment('5')?.hash).toBe(HASH_A);
    expect(getCommitment('204')?.hash).toBe(HASH_A);
  });

  it('works without storage (blocked site data)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => recordCommitment('1', HASH_A)).not.toThrow();
    expect(getCommitment('1')).toBeNull();
  });
});
