import type {
  BlackjackActionRequest,
  BlackjackRoundResponse,
  OpenRoundResponse,
  RoundSummary,
  RouletteSpinRequest,
  RouletteSpinResponse,
  SlotSpinResponse,
  StakeRequest,
  VideoPokerDrawRequest,
  VideoPokerRoundResponse,
} from '@casino/shared';
import { recordRoundCommitment } from '../lib/commitments.ts';
import { apiFetch } from './client.ts';

/** Every round answer carries its seed pair's hash: this browser keeps it until the reveal. */
async function played<T extends { round: RoundSummary }>(request: Promise<T>): Promise<T> {
  const res = await request;
  recordRoundCommitment(res.round?.fairness);
  return res;
}

async function resumed<T extends { round: RoundSummary }>(
  request: Promise<OpenRoundResponse<T>>,
): Promise<OpenRoundResponse<T>> {
  const res = await request;
  recordRoundCommitment(res.round?.round?.fairness);
  return res;
}

export function spinRoulette(body: RouletteSpinRequest): Promise<RouletteSpinResponse> {
  return played(apiFetch<RouletteSpinResponse>('/games/roulette/spin', { method: 'POST', body }));
}

export function spinSlot(body: StakeRequest): Promise<SlotSpinResponse> {
  return played(apiFetch<SlotSpinResponse>('/games/slot/spin', { method: 'POST', body }));
}

export function blackjackDeal(body: StakeRequest): Promise<BlackjackRoundResponse> {
  return played(
    apiFetch<BlackjackRoundResponse>('/games/blackjack/deal', { method: 'POST', body }),
  );
}

export function blackjackAction(body: BlackjackActionRequest): Promise<BlackjackRoundResponse> {
  return played(
    apiFetch<BlackjackRoundResponse>('/games/blackjack/action', { method: 'POST', body }),
  );
}

export function blackjackOpen(): Promise<OpenRoundResponse<BlackjackRoundResponse>> {
  return resumed(apiFetch<OpenRoundResponse<BlackjackRoundResponse>>('/games/blackjack/open'));
}

export function videoPokerDeal(body: StakeRequest): Promise<VideoPokerRoundResponse> {
  return played(
    apiFetch<VideoPokerRoundResponse>('/games/videopoker/deal', { method: 'POST', body }),
  );
}

export function videoPokerDraw(body: VideoPokerDrawRequest): Promise<VideoPokerRoundResponse> {
  return played(
    apiFetch<VideoPokerRoundResponse>('/games/videopoker/draw', { method: 'POST', body }),
  );
}

export function videoPokerOpen(): Promise<OpenRoundResponse<VideoPokerRoundResponse>> {
  return resumed(apiFetch<OpenRoundResponse<VideoPokerRoundResponse>>('/games/videopoker/open'));
}
