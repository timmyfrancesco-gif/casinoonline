import {
  blackjackAllowedActions,
  blackjackApply,
  blackjackBasicStrategy,
  rankIndex,
  STARTING_BALANCE,
  VIDEO_POKER_PAYTABLE,
  type BlackjackState,
} from '@casino/engine';
import type {
  BlackjackRoundResponse,
  OpenRoundResponse,
  RouletteSpinResponse,
  SlotSpinResponse,
  VideoPokerRoundResponse,
} from '@casino/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  blackjackDealWith,
  CHIP,
  createTestEnv,
  expectError,
  expectLedgerInvariants,
  key,
  prepareNextRound,
  registerPlayer,
  setInitialBalance,
  truncateAll,
  videoPokerDealWith,
  type Player,
  type TestEnv,
} from './helpers.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await truncateAll(env.pool);
});

async function dbState(roundId: string): Promise<BlackjackState> {
  const { rows } = await env.pool.query('SELECT state FROM rounds WHERE id = $1', [roundId]);
  return rows[0].state as BlackjackState;
}

/** Plays the open blackjack round to the end with basic strategy (never splits/doubles). */
async function finishBlackjack(
  p: Player,
  res: BlackjackRoundResponse,
): Promise<BlackjackRoundResponse> {
  let current = res;
  while (current.state.phase === 'player') {
    const suggestion = blackjackBasicStrategy(current.state);
    const action = suggestion === 'hit' ? 'hit' : 'stand';
    const next = await p.post('/api/games/blackjack/action', {
      roundId: current.round.id,
      action,
      step: current.state.step,
    });
    expect(next.statusCode, next.body).toBe(200);
    current = next.json<BlackjackRoundResponse>();
  }
  return current;
}

describe('roulette', () => {
  it('spins, settles and pays through the ledger', async () => {
    const p = await registerPlayer(env.app);
    const bets = [
      { type: 'red', amount: 10 * CHIP },
      { type: 'straight', numbers: [17], amount: 2 * CHIP },
      { type: 'dozen', index: 2, amount: 5 * CHIP },
      { type: 'corner', numbers: [5, 1, 2, 4], amount: CHIP },
    ];
    const res = await p.post('/api/games/roulette/spin', { bets, idempotencyKey: key() });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<RouletteSpinResponse>();
    expect(body.settlement.totalBet).toBe(18 * CHIP);
    expect(body.settlement.bets).toHaveLength(4);
    expect(body.round).toMatchObject({
      game: 'roulette',
      status: 'settled',
      stake: 18 * CHIP,
      payout: body.settlement.totalWin,
    });
    expect(body.round.fairness.serverSeed).toBeNull();
    expect(body.round.fairness.nonce).toBe(0);
    expect(body.round.fairness.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.balance).toBe(STARTING_BALANCE - 18 * CHIP + body.settlement.totalWin);
    expect((await p.get('/api/wallet')).json()).toEqual({ balance: body.balance });
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('enforces the bet layout and the table limits', async () => {
    const p = await registerPlayer(env.app);
    const spin = (bets: unknown[]) =>
      p.post('/api/games/roulette/spin', { bets, idempotencyKey: key() });
    expectError(await spin([{ type: 'split', numbers: [1, 5], amount: CHIP }]), 400, 'BET_LIMIT');
    expectError(
      await spin([{ type: 'straight', numbers: [37], amount: CHIP }]),
      400,
      'VALIDATION_ERROR',
    );
    expectError(await spin([{ type: 'red', amount: 150 }]), 400, 'VALIDATION_ERROR');
    expectError(await spin([{ type: 'red', amount: 101 * CHIP }]), 400, 'BET_LIMIT');
    // The per-position maximum cannot be bypassed by splitting the same bet.
    expectError(
      await spin([
        { type: 'red', amount: 60 * CHIP },
        { type: 'red', amount: 60 * CHIP },
      ]),
      400,
      'BET_LIMIT',
    );
    const tooMuch = Array.from({ length: 6 }, (_, i) => ({
      type: 'straight',
      numbers: [i + 1],
      amount: 100 * CHIP,
    }));
    const err = expectError(await spin(tooMuch), 400, 'BET_LIMIT');
    expect(err.details).toMatchObject({ maxPerRound: 500 * CHIP });
    expectError(await spin([]), 400, 'VALIDATION_ERROR');
    const rounds = await env.pool.query('SELECT COUNT(*) AS n FROM rounds');
    expect(rounds.rows[0].n).toBe(0);
  });
});

describe('slot', () => {
  it('spins with the engine settlement', async () => {
    const p = await registerPlayer(env.app);
    const res = await p.post('/api/games/slot/spin', { amount: 5 * CHIP, idempotencyKey: key() });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<SlotSpinResponse>();
    expect(body.settlement.bet).toBe(5 * CHIP);
    expect(body.settlement.win).toBe(5 * CHIP * body.settlement.multiplier);
    expect(body.settlement.window).toHaveLength(3);
    expect(body.round.payout).toBe(body.settlement.win);
    expect(body.balance).toBe(STARTING_BALANCE - 5 * CHIP + body.settlement.win);
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('rejects stakes outside the limits and without funds', async () => {
    const p = await registerPlayer(env.app);
    expectError(
      await p.post('/api/games/slot/spin', { amount: 51 * CHIP, idempotencyKey: key() }),
      400,
      'BET_LIMIT',
    );
    expectError(
      await p.post('/api/games/slot/spin', { amount: 50, idempotencyKey: key() }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: 'non-uuid' }),
      400,
      'VALIDATION_ERROR',
    );
    await setInitialBalance(env.pool, p.userId, 3 * CHIP);
    const err = expectError(
      await p.post('/api/games/slot/spin', { amount: 4 * CHIP, idempotencyKey: key() }),
      400,
      'INSUFFICIENT_FUNDS',
    );
    expect(err.details).toEqual({ balance: 3 * CHIP, required: 4 * CHIP });
  });
});

describe('blackjack', () => {
  it('deals with the public view only and resumes the open hand', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(10 * CHIP, (s) => s.phase === 'player'),
    );
    const deal = await p.post('/api/games/blackjack/deal', {
      amount: 10 * CHIP,
      idempotencyKey: key(),
    });
    expect(deal.statusCode, deal.body).toBe(200);
    const body = deal.json<BlackjackRoundResponse>();
    expect(body.round.status).toBe('open');
    expect(body.round.payout).toBe(0);
    expect(body.state.phase).toBe('player');
    expect(body.state.dealer.cards).toHaveLength(2);
    expect(body.state.dealer.cards[1]).toBeNull();
    expect(deal.body).not.toContain('shoe');
    expect(body.balance).toBe(STARTING_BALANCE - 10 * CHIP);

    const open = await p.get('/api/games/blackjack/open');
    const resumed = open.json<OpenRoundResponse<BlackjackRoundResponse>>();
    expect(resumed.round).toEqual(body);
    expect(open.body).not.toContain('shoe');

    const again = await p.post('/api/games/blackjack/deal', {
      amount: 10 * CHIP,
      idempotencyKey: key(),
    });
    const err = expectError(again, 409, 'ROUND_ALREADY_OPEN');
    expect(err.details).toEqual({ roundId: body.round.id });

    // Open-round detail in the history is public too.
    const detail = await p.get(`/api/history/${body.round.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain('shoe');
    expect(detail.json().verifyInput).toBeNull();
    expect(detail.json().detail.state.dealer.cards[1]).toBeNull();

    const final = await finishBlackjack(p, body);
    expect(final.round.status).toBe('settled');
    expect(final.round.payout).toBe(final.state.result!.totalPayout);
    expect(final.state.dealer.cards.every((c) => c !== null)).toBe(true);
    expect((await p.get('/api/games/blackjack/open')).json()).toEqual({ round: null });
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('rejects a stale step with 409 CONFLICT and the current round', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(
      p,
      env.pool,
      // After one hit the hand is still being played.
      blackjackDealWith(
        CHIP,
        (s) => s.phase === 'player' && blackjackApply(s, 'hit').phase === 'player',
      ),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    const hit = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'hit',
      step: 0,
    });
    expect(hit.statusCode, hit.body).toBe(200);
    const afterHit = hit.json<BlackjackRoundResponse>();
    const stale = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'stand',
      step: 0,
    });
    const err = expectError(stale, 409, 'CONFLICT');
    expect((err.details as { round: BlackjackRoundResponse }).round).toEqual(afterHit);
    expect(stale.body).not.toContain('shoe');

    if (afterHit.state.phase === 'player') await finishBlackjack(p, afterHit);
    const closed = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'stand',
      step: 99,
    });
    expectError(closed, 409, 'ROUND_NOT_OPEN');
    expectError(
      await p.post('/api/games/blackjack/action', { roundId: '999999', action: 'stand', step: 0 }),
      409,
      'ROUND_NOT_OPEN',
    );
  });

  it('does not let a player act on somebody else’s round', async () => {
    const a = await registerPlayer(env.app);
    const b = await registerPlayer(env.app);
    await prepareNextRound(
      a,
      env.pool,
      blackjackDealWith(CHIP, (s) => s.phase === 'player'),
    );
    const deal = (
      await a.post('/api/games/blackjack/deal', { amount: CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    expectError(
      await b.post('/api/games/blackjack/action', {
        roundId: deal.round.id,
        action: 'stand',
        step: 0,
      }),
      409,
      'ROUND_NOT_OPEN',
    );
    expectError(await b.get(`/api/history/${deal.round.id}`), 404, 'NOT_FOUND');
  });

  it('charges split and double, and settles the total', async () => {
    const p = await registerPlayer(env.app);
    const bet = 10 * CHIP;
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(bet, (s) => {
        if (s.phase !== 'player') return false;
        const [c1, c2] = s.hands[0]!.cards as [number, number];
        // A splittable pair of 2s..8s where the first split hand can then double.
        if (rankIndex(c1) !== rankIndex(c2) || rankIndex(c1) < 1 || rankIndex(c1) > 7) {
          return false;
        }
        const afterSplit = blackjackApply(s, 'split');
        return blackjackAllowedActions(afterSplit).includes('double');
      }),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: bet, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    expect(deal.state.allowedActions).toContain('split');

    const split = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'split',
      step: 0,
    });
    expect(split.statusCode, split.body).toBe(200);
    const afterSplit = split.json<BlackjackRoundResponse>();
    expect(afterSplit.state.hands).toHaveLength(2);
    expect(afterSplit.round.stake).toBe(2 * bet);
    expect(afterSplit.balance).toBe(STARTING_BALANCE - 2 * bet);

    expect(afterSplit.state.allowedActions).toContain('double');
    const dbl = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'double',
      step: afterSplit.state.step,
    });
    expect(dbl.statusCode, dbl.body).toBe(200);
    const afterDouble = dbl.json<BlackjackRoundResponse>();
    const expectedStake = 3 * bet;
    expect(afterDouble.round.stake).toBe(expectedStake);
    expect(afterDouble.state.hands[0]!.doubled).toBe(true);
    expect(afterDouble.state.hands[0]!.bet).toBe(2 * bet);
    const final = await finishBlackjack(p, afterDouble);
    expect(final.round.stake).toBe(expectedStake);
    expect(final.state.totalBet).toBe(expectedStake);
    expect(final.round.payout).toBe(final.state.result!.totalPayout);
    expect(final.balance).toBe(STARTING_BALANCE - expectedStake + final.round.payout);
    const stakes = await env.pool.query(
      `SELECT amount FROM ledger WHERE round_id = $1 AND kind = 'stake' ORDER BY id`,
      [deal.round.id],
    );
    expect(stakes.rows.map((r) => r.amount)).toEqual([-bet, -bet, -bet]);
    const stored = await dbState(deal.round.id);
    expect(stored.actions.slice(0, 2)).toEqual(['split', 'double']);
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('rejects a double without funds and illegal actions, then completes the hand', async () => {
    const p = await registerPlayer(env.app);
    await setInitialBalance(env.pool, p.userId, 15 * CHIP);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(10 * CHIP, (s) => {
        const [c1, c2] = s.hands[0]!.cards as [number, number];
        return s.phase === 'player' && rankIndex(c1) !== rankIndex(c2);
      }),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: 10 * CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    expect(deal.balance).toBe(5 * CHIP);
    const dbl = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'double',
      step: 0,
    });
    const err = expectError(dbl, 400, 'INSUFFICIENT_FUNDS');
    expect(err.details).toEqual({ balance: 5 * CHIP, required: 10 * CHIP });
    const split = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'split',
      step: 0,
    });
    const illegal = expectError(split, 400, 'ILLEGAL_ACTION');
    expect(illegal.details).toMatchObject({ allowedActions: ['hit', 'stand', 'double'] });

    const stand = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'stand',
      step: 0,
    });
    expect(stand.statusCode, stand.body).toBe(200);
    const final = stand.json<BlackjackRoundResponse>();
    expect(final.round.status).toBe('settled');
    expect(final.round.stake).toBe(10 * CHIP);
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('settles a natural blackjack immediately at 3:2', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(10 * CHIP, (s) => s.result?.hands[0]?.outcome === 'blackjack'),
    );
    const res = await p.post('/api/games/blackjack/deal', {
      amount: 10 * CHIP,
      idempotencyKey: key(),
    });
    const body = res.json<BlackjackRoundResponse>();
    expect(body.round.status).toBe('settled');
    expect(body.round.payout).toBe(25 * CHIP);
    expect(body.balance).toBe(STARTING_BALANCE + 15 * CHIP);
    const history = (await p.get('/api/history')).json();
    expect(history.items[0].summary).toBe('Blackjack!');
    await expectLedgerInvariants(env.pool, p.userId);
  });
});

describe('video poker', () => {
  it('deals, draws and pays the paytable', async () => {
    const p = await registerPlayer(env.app);
    const deal = await p.post('/api/games/videopoker/deal', {
      amount: 5 * CHIP,
      idempotencyKey: key(),
    });
    expect(deal.statusCode, deal.body).toBe(200);
    const body = deal.json<VideoPokerRoundResponse>();
    expect(body.state.phase).toBe('hold');
    expect(body.state.hand).toHaveLength(5);
    expect(deal.body).not.toContain('deck');
    expect(body.balance).toBe(STARTING_BALANCE - 5 * CHIP);

    const open = (await p.get('/api/games/videopoker/open')).json<
      OpenRoundResponse<VideoPokerRoundResponse>
    >();
    expect(open.round).toEqual(body);
    expectError(
      await p.post('/api/games/videopoker/deal', { amount: 5 * CHIP, idempotencyKey: key() }),
      409,
      'ROUND_ALREADY_OPEN',
    );

    const held = [true, false, true, false, false];
    const stale = await p.post('/api/games/videopoker/draw', {
      roundId: body.round.id,
      held,
      step: 1,
    });
    const err = expectError(stale, 409, 'CONFLICT');
    expect((err.details as { round: VideoPokerRoundResponse }).round).toEqual(body);

    const draw = await p.post('/api/games/videopoker/draw', {
      roundId: body.round.id,
      held,
      step: 0,
    });
    expect(draw.statusCode, draw.body).toBe(200);
    const final = draw.json<VideoPokerRoundResponse>();
    expect(final.state.phase).toBe('settled');
    expect(final.state.hand[0]).toBe(body.state.hand[0]);
    expect(final.state.hand[2]).toBe(body.state.hand[2]);
    const multiplier = VIDEO_POKER_PAYTABLE[final.state.result!.rank];
    expect(final.round.payout).toBe(5 * CHIP * multiplier);
    expect(final.balance).toBe(STARTING_BALANCE - 5 * CHIP + final.round.payout);
    expect(draw.body).not.toContain('deck');

    expectError(
      await p.post('/api/games/videopoker/draw', { roundId: body.round.id, held, step: 1 }),
      409,
      'ROUND_NOT_OPEN',
    );
    expectError(
      await p.post('/api/games/videopoker/draw', { roundId: body.round.id, held: [true], step: 1 }),
      400,
      'VALIDATION_ERROR',
    );
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('pays a dealt winning hand kept in full', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(
      p,
      env.pool,
      videoPokerDealWith(CHIP, (s) => {
        const ranks = s.hand.map(rankIndex);
        return (
          new Set(ranks).size === 3 && ranks.some((r) => ranks.filter((x) => x === r).length === 2)
        );
      }),
    );
    const deal = (
      await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey: key() })
    ).json<VideoPokerRoundResponse>();
    expect(deal.state.currentRank).toBe('TWO_PAIR');
    const draw = (
      await p.post('/api/games/videopoker/draw', {
        roundId: deal.round.id,
        held: [true, true, true, true, true],
        step: 0,
      })
    ).json<VideoPokerRoundResponse>();
    expect(draw.state.result).toEqual({ rank: 'TWO_PAIR', multiplier: 2, payout: 2 * CHIP });
    expect(draw.balance).toBe(STARTING_BALANCE + CHIP);
    const history = (await p.get('/api/history')).json();
    expect(history.items[0].summary).toBe('Doppia coppia');
  });
});
