import type { FairnessResponse, RotateSeedRequest } from '@casino/shared';
import { recordCommitment } from '../lib/commitments.ts';
import { apiFetch } from './client.ts';

/** The active pair's hash is kept in this browser before its seed is revealed. */
function remember(data: FairnessResponse): FairnessResponse {
  if (data?.active) recordCommitment(data.active.id, data.active.serverSeedHash);
  return data;
}

export async function getFairness(): Promise<FairnessResponse> {
  return remember(await apiFetch<FairnessResponse>('/fairness'));
}

/**
 * `body.nextServerSeedHash` binds the rotation to the next-seed hash shown to the player (the
 * server refuses a stale one). That hash, seen before the client seed was chosen, is recorded as
 * the new pair's commitment, not the hash sent back now: a different seed would be flagged.
 */
export async function rotateSeeds(body: RotateSeedRequest): Promise<FairnessResponse> {
  const data = await apiFetch<FairnessResponse>('/fairness/rotate', { method: 'POST', body });
  if (data?.active && body.nextServerSeedHash) {
    recordCommitment(data.active.id, body.nextServerSeedHash);
  }
  return remember(data);
}
