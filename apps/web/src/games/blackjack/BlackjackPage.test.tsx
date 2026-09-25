import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BlackjackPublicState } from '@casino/engine';
import type { BlackjackRoundResponse, RoundSummary } from '@casino/shared';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderRoute } from '../../test/utils.tsx';
import { BlackjackPage } from './BlackjackPage.tsx';

const SUMMARY: RoundSummary = {
  id: '42',
  game: 'blackjack',
  status: 'open',
  stake: 500,
  payout: 0,
  createdAt: '2026-09-25T10:00:00.000Z',
  settledAt: null,
  fairness: {
    seedPairId: '7',
    serverSeedHash: 'a'.repeat(64),
    clientSeed: 'client',
    nonce: 3,
    serverSeed: null,
  },
};

// 10♠ (code 9) + 6♠ (code 5) against the dealer's 10♥ (code 22) and a hole card.
const PLAYING: BlackjackPublicState = {
  phase: 'player',
  step: 0,
  active: 0,
  hands: [
    {
      cards: [9, 5],
      bet: 500,
      doubled: false,
      fromSplit: false,
      done: false,
      total: 16,
      soft: false,
      result: null,
    },
  ],
  dealer: { cards: [22, null], total: 10, soft: false },
  allowedActions: ['hit', 'stand', 'double'],
  totalBet: 500,
  result: null,
};

function round(
  state: BlackjackPublicState,
  overrides: Partial<RoundSummary> = {},
): BlackjackRoundResponse {
  return { round: { ...SUMMARY, ...overrides }, state, balance: 99_500 };
}

// Hit: 10♠ 6♠ + 5♦ (code 30) = 21, auto-stand; dealer 10♥ 8♣ (code 46) = 18. Player wins.
const SETTLED: BlackjackPublicState = {
  phase: 'settled',
  step: 1,
  active: 0,
  hands: [
    {
      cards: [9, 5, 30],
      bet: 500,
      doubled: false,
      fromSplit: false,
      done: true,
      total: 21,
      soft: false,
      result: { outcome: 'win', payout: 1000 },
    },
  ],
  dealer: { cards: [22, 46], total: 18, soft: false },
  allowedActions: [],
  totalBet: 500,
  result: {
    hands: [{ outcome: 'win', payout: 1000 }],
    dealerTotal: 18,
    dealerBlackjack: false,
    dealerBusted: false,
    totalBet: 500,
    totalPayout: 1000,
  },
};

function baseHandler(url: string): Response | null {
  if (url === '/api/auth/me') return jsonResponse(ME);
  if (url === '/api/rg') return jsonResponse(RG);
  if (url.startsWith('/api/history') || url === '/api/stats' || url === '/api/fairness') {
    return jsonResponse({});
  }
  return null;
}

describe('BlackjackPage', () => {
  it('resumes the open round and renders only the allowed actions', async () => {
    mockFetch(({ url }) => {
      const base = baseHandler(url);
      if (base) return base;
      if (url === '/api/games/blackjack/open') return jsonResponse({ round: round(PLAYING) });
      return errorResponse(404, 'NOT_FOUND');
    });
    renderRoute(<BlackjackPage />, { path: '/blackjack' });

    expect(await screen.findByRole('button', { name: /Carta/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Stai/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Raddoppia/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Dividi/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Carta coperta' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '10 di picche' })).toBeInTheDocument();
    expect(screen.getByText(/Hai una mano in corso/)).toBeInTheDocument();
  });

  it('sends the action with the current step on the H shortcut and shows the result', async () => {
    const { calls } = mockFetch(({ url, method }) => {
      const base = baseHandler(url);
      if (base) return base;
      if (url === '/api/games/blackjack/open') return jsonResponse({ round: round(PLAYING) });
      if (url === '/api/games/blackjack/action' && method === 'POST') {
        return jsonResponse({
          ...round(SETTLED, { status: 'settled', payout: 1000 }),
          balance: 100_500,
        });
      }
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<BlackjackPage />, { path: '/blackjack' });
    await screen.findByRole('button', { name: /Carta/ });

    await user.keyboard('h');

    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/games/blackjack/action')?.body).toEqual({
        roundId: '42',
        action: 'hit',
        step: 0,
      }),
    );
    expect(await screen.findByText('Mano vinta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Carta/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuova mano/ })).toBeInTheDocument();
  });

  it('resynchronises from details.round on 409 CONFLICT', async () => {
    const newer: BlackjackPublicState = {
      ...PLAYING,
      step: 1,
      hands: [{ ...PLAYING.hands[0]!, cards: [9, 5, 13], total: 17 }],
      allowedActions: ['hit', 'stand'],
    };
    mockFetch(({ url }) => {
      const base = baseHandler(url);
      if (base) return base;
      if (url === '/api/games/blackjack/open') return jsonResponse({ round: round(PLAYING) });
      if (url === '/api/games/blackjack/action') {
        return errorResponse(409, 'CONFLICT', 'Passo non aggiornato', { round: round(newer) });
      }
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<BlackjackPage />, { path: '/blackjack' });
    await user.click(await screen.findByRole('button', { name: /Raddoppia/ }));

    expect(await screen.findByText(/stato aggiornato/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Raddoppia/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('img', { name: 'Asso di cuori' })).toBeInTheDocument();
  });

  it('shows the outcome from details.round on 409 ROUND_NOT_OPEN (hand settled elsewhere)', async () => {
    mockFetch(({ url }) => {
      const base = baseHandler(url);
      if (base) return base;
      if (url === '/api/games/blackjack/open') return jsonResponse({ round: round(PLAYING) });
      if (url === '/api/games/blackjack/action') {
        return errorResponse(409, 'ROUND_NOT_OPEN', 'Mano già conclusa', {
          round: { ...round(SETTLED, { status: 'settled', payout: 1000 }), balance: 100_500 },
        });
      }
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<BlackjackPage />, { path: '/blackjack' });
    await user.click(await screen.findByRole('button', { name: /Stai/ }));

    expect(await screen.findByText('Mano vinta')).toBeInTheDocument();
    expect(screen.getByText(/La mano era già conclusa/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuova mano/ })).toBeInTheDocument();
  });

  it('deals a new hand with the table minimum and an idempotency key', async () => {
    const { calls } = mockFetch(({ url }) => {
      const base = baseHandler(url);
      if (base) return base;
      if (url === '/api/games/blackjack/open') return jsonResponse({ round: null });
      if (url === '/api/games/blackjack/deal') return jsonResponse(round(PLAYING));
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<BlackjackPage />, { path: '/blackjack' });
    const deal = await screen.findByRole('button', { name: /Distribuisci/ });
    await waitFor(() => expect(deal).toBeEnabled());
    await act(async () => {
      await user.click(deal);
    });
    const body = calls.find((c) => c.url === '/api/games/blackjack/deal')?.body as {
      amount: number;
      idempotencyKey: string;
    };
    expect(body.amount).toBe(100);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('button', { name: /Stai/ })).toBeInTheDocument();
  });
});
