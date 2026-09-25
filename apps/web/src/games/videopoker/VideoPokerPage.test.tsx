import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { VideoPokerPublicState } from '@casino/engine';
import type { RoundSummary, VideoPokerRoundResponse } from '@casino/shared';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderRoute } from '../../test/utils.tsx';
import { VideoPokerPage } from './VideoPokerPage.tsx';

const SUMMARY: RoundSummary = {
  id: '51',
  game: 'videopoker',
  status: 'open',
  stake: 100,
  payout: 0,
  createdAt: '2026-09-25T10:00:00.000Z',
  settledAt: null,
  fairness: {
    seedPairId: '7',
    serverSeedHash: 'a'.repeat(64),
    clientSeed: 'client',
    nonce: 4,
    serverSeed: null,
  },
};

// J♠ J♥ 2♦ 5♣ 8♠: a pair of jacks.
const HAND = [10, 23, 27, 43, 7];

const HOLDING: VideoPokerPublicState = {
  bet: 100,
  phase: 'hold',
  step: 0,
  hand: HAND,
  dealt: HAND,
  held: null,
  currentRank: 'JACKS_OR_BETTER',
  result: null,
};

// Everything held: Jacks or Better returns the stake (net 0).
const SETTLED: VideoPokerPublicState = {
  ...HOLDING,
  phase: 'settled',
  step: 1,
  held: [true, true, true, true, true],
  result: { rank: 'JACKS_OR_BETTER', multiplier: 1, payout: 100 },
};

function round(state: VideoPokerPublicState, balance: number): VideoPokerRoundResponse {
  const settled = state.phase === 'settled';
  return {
    round: {
      ...SUMMARY,
      status: settled ? 'settled' : 'open',
      payout: state.result?.payout ?? 0,
      settledAt: settled ? '2026-09-25T10:00:05.000Z' : null,
    },
    state,
    balance,
  };
}

function handler({ url }: { url: string }): Response {
  if (url === '/api/auth/me') return jsonResponse(ME);
  if (url === '/api/rg') return jsonResponse(RG);
  if (url === '/api/games/videopoker/open') return jsonResponse({ round: null });
  if (url === '/api/games/videopoker/deal') return jsonResponse(round(HOLDING, 99_900));
  if (url === '/api/games/videopoker/draw') return jsonResponse(round(SETTLED, 100_000));
  if (url.startsWith('/api/')) return jsonResponse({});
  return errorResponse(404, 'NOT_FOUND');
}

const jacksRow = () =>
  screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Coppia di J o superiore'));

describe('VideoPokerPage', () => {
  it('keeps keyboard focus on the next control and does not celebrate a break-even hand', async () => {
    mockFetch(handler);
    const user = userEvent.setup({ delay: null });
    renderRoute(<VideoPokerPage />, { path: '/videopoker' });
    const deal = await screen.findByRole('button', { name: /Distribuisci/ });
    await waitFor(() => expect(deal).toBeEnabled());
    deal.focus();
    await user.keyboard('{Enter}');

    const draw = await screen.findByRole('button', { name: /^Cambia/ });
    await waitFor(() => expect(draw).toHaveFocus());
    await user.keyboard('12345');
    await user.click(screen.getByRole('button', { name: 'Cambia 0 carte' }));

    expect(await screen.findByText(/in pari/)).toBeInTheDocument();
    expect(jacksRow()).toHaveClass('row-current');
    expect(jacksRow()).not.toHaveClass('row-win');
    await waitFor(() => expect(screen.getByRole('button', { name: /Distribuisci/ })).toHaveFocus());
  });

  it('reports a failed check of the open hand, with a retry, and still lets the player deal', async () => {
    let openFails = true;
    mockFetch((call) =>
      call.url === '/api/games/videopoker/open' && openFails
        ? errorResponse(503, 'INTERNAL')
        : handler(call),
    );
    const user = userEvent.setup({ delay: null });
    renderRoute(<VideoPokerPage />, { path: '/videopoker' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossibile controllare se hai una mano in corso',
    );
    expect(screen.queryByText(/per ricevere 5 carte/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Distribuisci/ })).toBeEnabled();

    openFails = false;
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText(/per ricevere 5 carte/)).toBeInTheDocument();
  });
});
