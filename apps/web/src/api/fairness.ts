import type { FairnessResponse, RotateSeedRequest } from '@casino/shared';
import { apiFetch } from './client.ts';

export function getFairness(): Promise<FairnessResponse> {
  return apiFetch<FairnessResponse>('/fairness');
}

export function rotateSeeds(body: RotateSeedRequest): Promise<FairnessResponse> {
  return apiFetch<FairnessResponse>('/fairness/rotate', { method: 'POST', body });
}
