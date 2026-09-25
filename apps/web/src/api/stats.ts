import type { StatsResponse } from '@casino/shared';
import { apiFetch } from './client.ts';

export function getStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>('/stats');
}
