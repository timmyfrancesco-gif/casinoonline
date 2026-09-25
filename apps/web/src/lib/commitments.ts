import { SERVER_SEED_PATTERN } from '@casino/engine';
import type { FairnessRef } from '@casino/shared';
import { readStorage, writeStorage } from './storage.ts';

/**
 * Server-seed commitments seen by this browser before the seed was revealed: seed pair id →
 * SHA-256 of the server seed. The verifier compares a revealed seed with this copy instead of
 * trusting the hash the server sends along with the seed. An entry is never overwritten.
 */
export interface Commitment {
  hash: string;
  /** ISO time this browser first saw the hash. */
  firstSeenAt: string;
}

const STORAGE_KEY = 'casino-seed-commitments';
const MAX_ENTRIES = 200;

function load(): Record<string, Commitment> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readStorage(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
  const out: Record<string, Commitment> = {};
  if (typeof parsed !== 'object' || parsed === null) return out;
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Partial<Commitment> | null;
    if (
      typeof entry?.hash === 'string' &&
      SERVER_SEED_PATTERN.test(entry.hash) &&
      typeof entry.firstSeenAt === 'string'
    ) {
      out[id] = { hash: entry.hash, firstSeenAt: entry.firstSeenAt };
    }
  }
  return out;
}

/** Records the hash of a seed pair the first time it is seen (later calls are ignored). */
export function recordCommitment(seedPairId: string, hash: string, now: Date = new Date()): void {
  if (typeof seedPairId !== 'string' || typeof hash !== 'string') return;
  const normalized = hash.toLowerCase();
  if (!SERVER_SEED_PATTERN.test(normalized)) return;
  const store = load();
  if (store[seedPairId]) return;
  store[seedPairId] = { hash: normalized, firstSeenAt: now.toISOString() };
  // Bounded: the oldest records go first.
  const entries = Object.entries(store)
    .sort(([, a], [, b]) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, MAX_ENTRIES);
  writeStorage(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

/** Records the commitment of a round's seed pair while its server seed is still secret. */
export function recordRoundCommitment(fairness: FairnessRef | null | undefined): void {
  if (fairness && fairness.serverSeed === null) {
    recordCommitment(fairness.seedPairId, fairness.serverSeedHash);
  }
}

export function getCommitment(seedPairId: string): Commitment | null {
  return load()[seedPairId] ?? null;
}
