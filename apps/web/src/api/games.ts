import type {
  BlackjackActionRequest,
  BlackjackRoundResponse,
  OpenRoundResponse,
  RouletteSpinRequest,
  RouletteSpinResponse,
  SlotSpinResponse,
  StakeRequest,
  VideoPokerDrawRequest,
  VideoPokerRoundResponse,
} from '@casino/shared';
import { apiFetch } from './client.ts';

export function spinRoulette(body: RouletteSpinRequest): Promise<RouletteSpinResponse> {
  return apiFetch<RouletteSpinResponse>('/games/roulette/spin', { method: 'POST', body });
}

export function spinSlot(body: StakeRequest): Promise<SlotSpinResponse> {
  return apiFetch<SlotSpinResponse>('/games/slot/spin', { method: 'POST', body });
}

export function blackjackDeal(body: StakeRequest): Promise<BlackjackRoundResponse> {
  return apiFetch<BlackjackRoundResponse>('/games/blackjack/deal', { method: 'POST', body });
}

export function blackjackAction(body: BlackjackActionRequest): Promise<BlackjackRoundResponse> {
  return apiFetch<BlackjackRoundResponse>('/games/blackjack/action', { method: 'POST', body });
}

export function blackjackOpen(): Promise<OpenRoundResponse<BlackjackRoundResponse>> {
  return apiFetch<OpenRoundResponse<BlackjackRoundResponse>>('/games/blackjack/open');
}

export function videoPokerDeal(body: StakeRequest): Promise<VideoPokerRoundResponse> {
  return apiFetch<VideoPokerRoundResponse>('/games/videopoker/deal', { method: 'POST', body });
}

export function videoPokerDraw(body: VideoPokerDrawRequest): Promise<VideoPokerRoundResponse> {
  return apiFetch<VideoPokerRoundResponse>('/games/videopoker/draw', { method: 'POST', body });
}

export function videoPokerOpen(): Promise<OpenRoundResponse<VideoPokerRoundResponse>> {
  return apiFetch<OpenRoundResponse<VideoPokerRoundResponse>>('/games/videopoker/open');
}
