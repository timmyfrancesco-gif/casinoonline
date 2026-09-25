import type { GameId } from '@casino/engine';
import type { HistoryPage, RoundDetailResponse } from '@casino/shared';
import { recordRoundCommitment } from '../lib/commitments.ts';
import { API_BASE, apiFetch, queryString } from './client.ts';

export interface HistoryParams {
  game?: GameId | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export function getHistory(params: HistoryParams = {}): Promise<HistoryPage> {
  return apiFetch<HistoryPage>(
    `/history${queryString({ game: params.game, cursor: params.cursor, limit: params.limit })}`,
  );
}

export async function getRoundDetail(id: string): Promise<RoundDetailResponse> {
  const data = await apiFetch<RoundDetailResponse>(`/history/${encodeURIComponent(id)}`);
  // Still unrevealed: its hash is a commitment this browser can keep.
  recordRoundCommitment(data.round?.fairness);
  return data;
}

/** Plain link (cookie-authenticated GET): the browser downloads the file, filtered by game. */
export function historyCsvUrl(game?: GameId): string {
  return `${API_BASE}/history/export.csv${queryString({ game })}`;
}
