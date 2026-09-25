import type { GameId } from '@casino/engine';
import type { HistoryPage, RoundDetailResponse } from '@casino/shared';
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

export function getRoundDetail(id: string): Promise<RoundDetailResponse> {
  return apiFetch<RoundDetailResponse>(`/history/${encodeURIComponent(id)}`);
}

/** Plain link (cookie-authenticated GET): the browser downloads the file. */
export const HISTORY_CSV_URL = `${API_BASE}/history/export.csv`;
