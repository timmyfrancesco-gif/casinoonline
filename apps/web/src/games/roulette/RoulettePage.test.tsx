import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { settleRoulette, type RouletteBet } from '@casino/engine';
import type { RouletteSpinResponse } from '@casino/shared';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderRoute } from '../../test/utils.tsx';
import { RoulettePage } from './RoulettePage.tsx';

function spinResponse(bets: RouletteBet[], number: number): RouletteSpinResponse {
  const settlement = settleRoulette(bets, number);
  return {
    round: {
      id: '5',
      game: 'roulette',
      status: 'settled',
      stake: settlement.totalBet,
      payout: settlement.totalWin,
      createdAt: '2026-09-25T10:00:00.000Z',
      settledAt: '2026-09-25T10:00:00.000Z',
      fairness: {
        seedPairId: '1',
        serverSeedHash: 'f'.repeat(64),
        clientSeed: 'c',
        nonce: 0,
        serverSeed: null,
      },
    },
    settlement,
    balance: ME.balance - settlement.totalBet + settlement.totalWin,
  };
}

describe('RoulettePage', () => {
  it('builds bets from table clicks and the bet-type selector, spins and shows per-bet results', async () => {
    const { calls } = mockFetch(({ url, body }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      if (url === '/api/games/roulette/spin') {
        return jsonResponse(spinResponse((body as { bets: RouletteBet[] }).bets, 17));
      }
      if (url.startsWith('/api/')) return jsonResponse({});
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });

    // Default chip = 1 (table minimum): straight on 17 and red.
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('button', { name: 'Rosso' }));
    // Keyboard-friendly selector: split 17-18 by picking two numbers.
    await user.click(screen.getByRole('radio', { name: /Cavallo/ }));
    await user.click(screen.getByRole('button', { name: /^17 nero/ }));
    await user.click(screen.getByRole('button', { name: /^18 rosso/ }));
    expect(screen.getByText('Cavallo 17-18')).toBeInTheDocument();
    expect(screen.getByText('3 fiches')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/games/roulette/spin')).toBe(true));
    const request = calls.find((c) => c.url === '/api/games/roulette/spin')!;
    expect(request.body).toMatchObject({
      bets: [
        { type: 'straight', numbers: [17], amount: 100 },
        { type: 'red', amount: 100 },
        { type: 'split', numbers: [17, 18], amount: 100 },
      ],
    });
    expect((request.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    // Reduced motion in tests: the wheel settles immediately.
    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    expect(screen.getByText(/Rientrano 54 fiches/, { selector: '.outcome p' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.some((t) => t.includes('Pieno 17') && t.includes('Vinta'))).toBe(true);
    expect(rows.some((t) => t.includes('Rosso') && t.includes('Persa'))).toBe(true);
    expect(screen.getByRole('list', { name: /Ultimi numeri/ })).toHaveTextContent('17');
  });

  it('refuses chips beyond the table limit per bet', async () => {
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      return jsonResponse({});
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('radio', { name: /100 fiches/ }));
    await user.click(screen.getByRole('button', { name: 'Nero' }));
    await user.click(screen.getByRole('button', { name: /^Nero/ }));
    expect(
      await screen.findByText(/Massimo 100 fiches su una singola puntata/, {
        selector: '.alert *',
      }),
    ).toBeInTheDocument();
  });
});
