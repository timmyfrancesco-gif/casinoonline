import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { hashServerSeed, verifyRound, type RouletteBet } from '@casino/engine';
import type { RoundDetailResponse } from '@casino/shared';
import { ME, errorResponse, jsonResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { VerifyPage, buildVerifyInput, formFromRound } from './VerifyPage.tsx';

const SERVER_SEED = '3b'.repeat(32);
const CLIENT_SEED = 'il-mio-seed';
const NONCE = 7;
const BETS: RouletteBet[] = [
  { type: 'red', amount: 500 },
  { type: 'straight', numbers: [17], amount: 100 },
];

/** A round as the server would record it, computed with the real engine. */
function recordedRound(): RoundDetailResponse {
  const result = verifyRound(
    { serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE },
    { game: 'roulette', bets: BETS },
  );
  if (result.game !== 'roulette') throw new Error('unexpected');
  return {
    round: {
      id: '12',
      game: 'roulette',
      status: 'settled',
      stake: 600,
      payout: result.settlement.totalWin,
      createdAt: '2026-09-25T10:00:00.000Z',
      settledAt: '2026-09-25T10:00:00.000Z',
      fairness: {
        seedPairId: '3',
        serverSeedHash: hashServerSeed(SERVER_SEED),
        clientSeed: CLIENT_SEED,
        nonce: NONCE,
        serverSeed: SERVER_SEED,
      },
    },
    detail: { game: 'roulette', bets: BETS, settlement: result.settlement },
    verifyInput: { game: 'roulette', bets: BETS },
  };
}

describe('VerifyPage', () => {
  it('prefills from a round and confirms hash and outcome in the browser', async () => {
    const round = recordedRound();
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/history/12') return jsonResponse(round);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<VerifyPage />, { path: '/verifica', url: '/verifica?round=12' });

    expect(await screen.findByDisplayValue(SERVER_SEED)).toBeInTheDocument();
    expect(screen.getByLabelText('Seed client')).toHaveValue(CLIENT_SEED);
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));

    expect(await screen.findByText(/il seed è quello promesso/)).toBeInTheDocument();
    expect(screen.getByText(/esito identico/)).toBeInTheDocument();
  });

  it('flags a seed that does not match the commitment', async () => {
    const round = recordedRound();
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/history/12') return jsonResponse(round);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<VerifyPage />, { path: '/verifica', url: '/verifica?round=12' });
    const seedInput = await screen.findByDisplayValue(SERVER_SEED);
    await user.clear(seedInput);
    await user.type(seedInput, '4c'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/il seed non corrisponde/)).toBeInTheDocument();
  });

  it('parses blackjack moves in Italian or English', () => {
    const form = {
      ...formFromRound(recordedRound()),
      game: 'blackjack' as const,
      bet: '5',
      actions: 'carta, stand, Raddoppia',
    };
    expect(buildVerifyInput(form)).toEqual({
      input: { game: 'blackjack', bet: 500, actions: ['hit', 'stand', 'double'] },
    });
    expect(buildVerifyInput({ ...form, actions: 'vola' })).toMatchObject({
      error: expect.stringContaining('vola'),
    });
  });
});
