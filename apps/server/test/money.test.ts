import { blackjackBasicStrategy, STARTING_BALANCE, videoPokerHoldAnalysis } from '@casino/engine';
import type {
  ApiErrorBody,
  BlackjackRoundResponse,
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

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await env.pool.query<{ n: number }>(sql, params);
  return rows[0]!.n;
}

describe('idempotency', () => {
  it('replays the same key and body without charging twice', async () => {
    const p = await registerPlayer(env.app);
    const body = { amount: 3 * CHIP, idempotencyKey: key() };
    const first = await p.post('/api/games/slot/spin', body);
    expect(first.statusCode, first.body).toBe(200);
    // Another spin in between: the replay still returns the original response.
    expect(
      (await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() })).statusCode,
    ).toBe(200);
    const second = await p.post('/api/games/slot/spin', body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(second.body).toBe(first.body);
    expect(
      await countRows(`SELECT COUNT(*) AS n FROM ledger WHERE user_id = $1 AND kind = 'stake'`, [
        p.userId,
      ]),
    ).toBe(2);
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('answers 409 CONFLICT when the key is reused with a different body or endpoint', async () => {
    const p = await registerPlayer(env.app);
    const idempotencyKey = key();
    expect(
      (await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey })).statusCode,
    ).toBe(200);
    expectError(
      await p.post('/api/games/slot/spin', { amount: 2 * CHIP, idempotencyKey }),
      409,
      'CONFLICT',
    );
    expectError(
      await p.post('/api/games/roulette/spin', {
        bets: [{ type: 'red', amount: CHIP }],
        idempotencyKey,
      }),
      409,
      'CONFLICT',
    );
    expectError(
      await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey }),
      409,
      'CONFLICT',
    );
    expect(await countRows('SELECT COUNT(*) AS n FROM rounds WHERE user_id = $1', [p.userId])).toBe(
      1,
    );
  });

  it('keys are per user', async () => {
    const a = await registerPlayer(env.app);
    const b = await registerPlayer(env.app);
    const body = { amount: CHIP, idempotencyKey: key() };
    expect((await a.post('/api/games/slot/spin', body)).statusCode).toBe(200);
    expect((await b.post('/api/games/slot/spin', body)).statusCode).toBe(200);
  });

  it('parallel retries of the same request create a single round', async () => {
    const p = await registerPlayer(env.app);
    const body = { bets: [{ type: 'black', amount: 7 * CHIP }], idempotencyKey: key() };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => p.post('/api/games/roulette/spin', body)),
    );
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    const bodies = results.map((r) => r.json());
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(await countRows('SELECT COUNT(*) AS n FROM rounds WHERE user_id = $1', [p.userId])).toBe(
      1,
    );
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('replays a deal as the current state of the round', async () => {
    const p = await registerPlayer(env.app);
    const body = { amount: CHIP, idempotencyKey: key() };
    const first = await p.post('/api/games/videopoker/deal', body);
    const replay = await p.post('/api/games/videopoker/deal', body);
    expect(replay.json()).toEqual(first.json());
    expect(replay.body).not.toContain('deck');
  });
});

describe('concurrency', () => {
  it('parallel spins never overdraw the balance', async () => {
    const p = await registerPlayer(env.app);
    const stake = 50 * CHIP;
    await setInitialBalance(env.pool, p.userId, 120 * CHIP);
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        p.post('/api/games/slot/spin', { amount: stake, idempotencyKey: key() }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 200).map((r) => r.json<SlotSpinResponse>());
    const failed = results.filter((r) => r.statusCode !== 200);
    for (const r of failed) {
      expect(r.statusCode).toBe(400);
      expect(r.json<ApiErrorBody>().error.code).toBe('INSUFFICIENT_FUNDS');
    }
    expect(ok.length).toBeGreaterThanOrEqual(2);
    for (const r of ok) expect(r.balance).toBeGreaterThanOrEqual(0);

    const won = ok.reduce((sum, r) => sum + r.settlement.win, 0);
    const wallet = (await p.get('/api/wallet')).json<{ balance: number }>().balance;
    expect(wallet).toBe(120 * CHIP - ok.length * stake + won);
    expect(wallet).toBeGreaterThanOrEqual(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM rounds WHERE user_id = $1', [p.userId])).toBe(
      ok.length,
    );
    // Nonces are unique and consecutive.
    const nonces = ok.map((r) => r.round.fairness.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual(Array.from({ length: ok.length }, (_, i) => i));
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('parallel actions on the same step apply once', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(CHIP, (s) => s.phase === 'player'),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        p.post('/api/games/blackjack/action', { roundId: deal.round.id, action: 'stand', step: 0 }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.statusCode !== 200)) {
      expect(r.statusCode).toBe(409);
      expect(['CONFLICT', 'ROUND_NOT_OPEN']).toContain(r.json<ApiErrorBody>().error.code);
    }
    await expectLedgerInvariants(env.pool, p.userId);
  });

  it('parallel doubles and spins from two tabs stay consistent', async () => {
    const p = await registerPlayer(env.app);
    await setInitialBalance(env.pool, p.userId, 30 * CHIP);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(10 * CHIP, (s) => s.phase === 'player' && s.hands[0]!.cards.length === 2),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: 10 * CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    const results = await Promise.all([
      p.post('/api/games/blackjack/action', { roundId: deal.round.id, action: 'double', step: 0 }),
      p.post('/api/games/slot/spin', { amount: 10 * CHIP, idempotencyKey: key() }),
      p.post('/api/games/slot/spin', { amount: 10 * CHIP, idempotencyKey: key() }),
    ]);
    for (const r of results) expect([200, 400]).toContain(r.statusCode);
    const wallet = (await p.get('/api/wallet')).json<{ balance: number }>().balance;
    expect(wallet).toBeGreaterThanOrEqual(0);
    await expectLedgerInvariants(env.pool, p.userId);
  });
});

async function playMixedSession(p: Player): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const r = await p.post('/api/games/roulette/spin', {
      bets: [
        { type: 'odd', amount: 3 * CHIP },
        { type: 'split', numbers: [0, 2], amount: CHIP },
        { type: 'column', index: 3, amount: 2 * CHIP },
      ],
      idempotencyKey: key(),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (await p.post('/api/games/slot/spin', { amount: 2 * CHIP, idempotencyKey: key() }))
        .statusCode,
    ).toBe(200);
  }
  for (let i = 0; i < 6; i++) {
    let bj = (
      await p.post('/api/games/blackjack/deal', { amount: 4 * CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    while (bj.state.phase === 'player') {
      const action = blackjackBasicStrategy(bj.state) ?? 'stand';
      const res = await p.post('/api/games/blackjack/action', {
        roundId: bj.round.id,
        action,
        step: bj.state.step,
      });
      expect(res.statusCode, res.body).toBe(200);
      bj = res.json<BlackjackRoundResponse>();
    }
    const vp = (
      await p.post('/api/games/videopoker/deal', { amount: 3 * CHIP, idempotencyKey: key() })
    ).json<VideoPokerRoundResponse>();
    const best = videoPokerHoldAnalysis(vp.state.hand)[0]!.held;
    const draw = await p.post('/api/games/videopoker/draw', {
      roundId: vp.round.id,
      held: best,
      step: 0,
    });
    expect(draw.statusCode, draw.body).toBe(200);
  }
}

describe('ledger invariants', () => {
  it('hold after a mixed session', async () => {
    const p = await registerPlayer(env.app);
    await playMixedSession(p);
    await expectLedgerInvariants(env.pool, p.userId);
    const { rows } = await env.pool.query(
      `SELECT COUNT(*) AS n FROM rounds WHERE user_id = $1 AND status = 'settled'`,
      [p.userId],
    );
    expect(rows[0].n).toBe(20);
  });

  it('reset restores the starting balance with a reset movement', async () => {
    const p = await registerPlayer(env.app);
    expectError(await p.post('/api/wallet/reset'), 409, 'RESET_NOT_ALLOWED');
    await setInitialBalance(env.pool, p.userId, 5 * CHIP);
    const deal = (
      await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey: key() })
    ).json<VideoPokerRoundResponse>();
    expectError(await p.post('/api/wallet/reset'), 409, 'RESET_NOT_ALLOWED');
    const draw = (
      await p.post('/api/games/videopoker/draw', {
        roundId: deal.round.id,
        held: [false, false, false, false, false],
        step: 0,
      })
    ).json<VideoPokerRoundResponse>();
    const statsBefore = (await p.get('/api/stats')).json();
    const res = await p.post('/api/wallet/reset');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ balance: STARTING_BALANCE });
    const reset = await env.pool.query(
      `SELECT amount FROM ledger WHERE user_id = $1 AND kind = 'reset'`,
      [p.userId],
    );
    expect(reset.rows).toEqual([{ amount: STARTING_BALANCE - draw.balance }]);
    const statsAfter = (await p.get('/api/stats')).json();
    expect(statsAfter.lifetime).toEqual(statsBefore.lifetime);
    expect(statsAfter.resets).toBe(1);
    await expectLedgerInvariants(env.pool, p.userId);
  });
});
