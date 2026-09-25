import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashServerSeed, verifyRound, type RouletteBet } from '@casino/engine';
import type { RoundDetailResponse } from '@casino/shared';
import { recordCommitment } from '../lib/commitments.ts';
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

function serve(round: RoundDetailResponse) {
  return mockFetch(({ url }) => {
    if (url === '/api/auth/me') return jsonResponse(ME);
    if (url === '/api/history/12') return jsonResponse(round);
    return errorResponse(404, 'NOT_FOUND');
  });
}

async function openRound(round: RoundDetailResponse) {
  serve(round);
  const user = userEvent.setup({ delay: null });
  renderRoute(<VerifyPage />, { path: '/verifica', url: '/verifica?round=12' });
  await screen.findByDisplayValue(SERVER_SEED);
  return user;
}

describe('VerifyPage', () => {
  beforeEach(() => localStorage.clear());

  it('prefills from a round and confirms hash and outcome in the browser', async () => {
    // The hash was recorded by this browser before the reveal (e.g. from a round answer).
    recordCommitment('3', hashServerSeed(SERVER_SEED), new Date('2026-09-25T09:00:00Z'));
    const user = await openRound(recordedRound());
    expect(screen.getByLabelText('Seed client')).toHaveValue(CLIENT_SEED);
    expect(screen.getByText(/Registrata da questo browser il/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));

    expect(await screen.findByText(/il seed è quello promesso/)).toBeInTheDocument();
    expect(screen.getByText(/esito identico/)).toBeInTheDocument();
  });

  it('explains the pre-committed next server seed and where to see its hash', async () => {
    await openRound(recordedRound());
    const text = screen.getByText(/fissato prima che tu scelga il seed client/);
    expect(text).toHaveTextContent('Hash del prossimo seed server');
    expect(screen.getByRole('link', { name: 'profilo' })).toHaveAttribute('href', '/profilo#seed');
  });

  it('does not call a hash sent together with the seed a promise', async () => {
    const user = await openRound(recordedRound());
    expect(screen.getByText(/Fornita ora dal server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));

    expect(await screen.findByText(/indicata ora dal server/)).toBeInTheDocument();
    expect(screen.queryByText(/il seed è quello promesso/)).not.toBeInTheDocument();
  });

  it('checks against the recorded hash and warns when the server now shows another one', async () => {
    // The server replaced seed and hash of the pair after this browser saw the original hash.
    recordCommitment('3', '9'.repeat(64), new Date('2026-09-25T09:00:00Z'));
    const user = await openRound(recordedRound());
    expect(screen.getByText(/Impronta diversa da quella registrata/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Impronta attesa/)).toHaveValue('9'.repeat(64));
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/il seed non corrisponde/)).toBeInTheDocument();
  });

  it('compares with the payout actually booked', async () => {
    const round = recordedRound();
    round.round.payout += 100;
    const user = await openRound(round);
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/esito diverso/)).toBeInTheDocument();
  });

  it('does not compare modified inputs with the recorded round', async () => {
    const user = await openRound(recordedRound());
    // A different losing bet set: same number and no win, but not the round that was played.
    fireEvent.change(screen.getByLabelText(/Puntate \(JSON/), {
      target: { value: '[{"type":"split","numbers":[1,2],"amount":100}]' },
    });
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/Dati modificati/)).toBeInTheDocument();
    expect(screen.queryByText(/esito identico/)).not.toBeInTheDocument();
  });

  it('rejects malformed bets and an empty nonce, clearing the previous result', async () => {
    const user = await openRound(recordedRound());
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/esito identico/)).toBeInTheDocument();

    const bets = screen.getByLabelText(/Puntate \(JSON/);
    for (const [value, message] of [
      ['[{"type":"split","numbers":[1,5],"amount":100}]', /Puntata 1: .*adiacenti/],
      ['[{"type":"dozen","index":7,"amount":100}]', /Puntata 1: .*1, 2 o 3/],
      ['[{"type":"red","amount":-1}]', /Puntata 1: .*intero positivo/],
      ['[{"foo":1}]', /Puntata 1: Tipo di puntata sconosciuto/],
      [JSON.stringify(Array(41).fill({ type: 'red', amount: 100 })), /Al massimo 40 puntate/],
    ] as const) {
      fireEvent.change(bets, { target: { value } });
      await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText(/esito identico/)).not.toBeInTheDocument();
    }

    fireEvent.change(bets, { target: { value: JSON.stringify(BETS) } });
    fireEvent.change(screen.getByLabelText('Nonce'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/nonce/);
  });

  it('explains an impossible sequence of moves in Italian', async () => {
    const user = await openRound(recordedRound());
    await user.selectOptions(screen.getByLabelText('Gioco'), 'blackjack');
    await user.type(screen.getByLabelText('Mosse, in ordine'), 'stand, hit');
    await user.click(screen.getByRole('button', { name: 'Ricalcola' }));
    expect(await screen.findByText(/Impossibile ricalcolare/)).toBeInTheDocument();
    expect(
      screen.getByText(/non sono validi per questo gioco. La mano è già conclusa/),
    ).toBeInTheDocument();
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
