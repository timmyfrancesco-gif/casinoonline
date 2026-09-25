import { rouletteColor, spinRoulette, spinSlot, evaluateSlot } from '@casino/engine';
import {
  LIMIT_INCREASE_DELAY_MS,
  SELF_EXCLUSION_MS,
  type BlackjackRoundResponse,
  type RgStatus,
} from '@casino/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  blackjackDealWith,
  CHIP,
  createTestEnv,
  expectError,
  key,
  loginPlayer,
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
  env.clock.offsetMs = 0;
});

const HOUR = 60 * 60 * 1000;

async function rg(p: Player): Promise<RgStatus> {
  const res = await p.get('/api/rg');
  expect(res.statusCode, res.body).toBe(200);
  return res.json<RgStatus>();
}

async function setLimit(p: Player, period: string, value: number | null): Promise<RgStatus> {
  const res = await p.put('/api/rg/loss-limit', { period, value });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<RgStatus>();
}

/** Moves the clock forward; sessions idle for 12 h expire, so the player logs in again. */
async function advance(p: Player, ms: number): Promise<void> {
  env.clock.advance(ms);
  p.cookie = (await loginPlayer(env.app, p.username)).cookie;
}

/** Plays one red bet that is guaranteed to lose (prepared seed). */
async function loseOnRed(p: Player, amount: number): Promise<void> {
  await prepareNextRound(p, env.pool, (rng) => {
    const n = spinRoulette(rng);
    return n === 0 || rouletteColor(n) === 'black';
  });
  const res = await p.post('/api/games/roulette/spin', {
    bets: [{ type: 'red', amount }],
    idempotencyKey: key(),
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().settlement.totalWin).toBe(0);
}

describe('loss limits', () => {
  it('rejects stakes beyond the limit with period and remaining', async () => {
    const p = await registerPlayer(env.app);
    const status = await setLimit(p, '24h', 50 * CHIP);
    expect(status.lossLimits['24h']).toEqual({
      value: 50 * CHIP,
      pending: null,
      used: 0,
      remaining: 50 * CHIP,
    });
    expect(status.lossLimits['7d'].value).toBeNull();

    const tooMuch = await p.post('/api/games/roulette/spin', {
      bets: [{ type: 'red', amount: 51 * CHIP }],
      idempotencyKey: key(),
    });
    const err = expectError(tooMuch, 403, 'RG_LOSS_LIMIT');
    expect(err.details).toEqual({ period: '24h', remaining: 50 * CHIP });

    await loseOnRed(p, 20 * CHIP);
    const after = await rg(p);
    expect(after.lossLimits['24h']).toMatchObject({ used: 20 * CHIP, remaining: 30 * CHIP });
    expect(after.lossLimits['30d'].used).toBe(20 * CHIP);

    const over = await p.post('/api/games/slot/spin', { amount: 31 * CHIP, idempotencyKey: key() });
    expect(expectError(over, 403, 'RG_LOSS_LIMIT').details).toEqual({
      period: '24h',
      remaining: 30 * CHIP,
    });
    const exact = await p.post('/api/games/slot/spin', {
      amount: 30 * CHIP,
      idempotencyKey: key(),
    });
    expect(exact.statusCode, exact.body).toBe(200);
  });

  it('reports the remaining stake in whole chips after a 3:2 payout', async () => {
    const p = await registerPlayer(env.app);
    // Blackjack pays 3:2: +1,50 chips, then -5 chips on red: 3,50 chips used.
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(CHIP, (st) => st.result?.hands[0]?.outcome === 'blackjack'),
    );
    const bj = await p.post('/api/games/blackjack/deal', { amount: CHIP, idempotencyKey: key() });
    expect(bj.json<BlackjackRoundResponse>().round).toMatchObject({
      status: 'settled',
      payout: 250,
    });
    await loseOnRed(p, 5 * CHIP);

    const status = await setLimit(p, '24h', 13 * CHIP);
    // The status stays exact: value = used + remaining.
    expect(status.lossLimits['24h']).toMatchObject({ used: 350, remaining: 950 });

    const over = await p.post('/api/games/slot/spin', { amount: 10 * CHIP, idempotencyKey: key() });
    const err = expectError(over, 403, 'RG_LOSS_LIMIT');
    expect(err.details).toEqual({ period: '24h', remaining: 9 * CHIP });
    expect(err.message).toContain('al massimo 9 fiches');
    const max = await p.post('/api/games/slot/spin', { amount: 9 * CHIP, idempotencyKey: key() });
    expect(max.statusCode, max.body).toBe(200);
  });

  it('reports the tightest violated period', async () => {
    const p = await registerPlayer(env.app);
    await setLimit(p, '24h', 30 * CHIP);
    await setLimit(p, '30d', 10 * CHIP);
    const res = await p.post('/api/games/slot/spin', { amount: 20 * CHIP, idempotencyKey: key() });
    expect(expectError(res, 403, 'RG_LOSS_LIMIT').details).toEqual({
      period: '30d',
      remaining: 10 * CHIP,
    });
  });

  it('lowering is immediate, raising and removing wait 24 hours', async () => {
    const p = await registerPlayer(env.app);
    await setLimit(p, '7d', 100 * CHIP);
    let s = await setLimit(p, '7d', 40 * CHIP);
    expect(s.lossLimits['7d']).toMatchObject({ value: 40 * CHIP, pending: null });

    const before = env.clock.now().getTime();
    s = await setLimit(p, '7d', 200 * CHIP);
    expect(s.lossLimits['7d'].value).toBe(40 * CHIP);
    expect(s.lossLimits['7d'].pending?.value).toBe(200 * CHIP);
    const effective = Date.parse(s.lossLimits['7d'].pending!.effectiveAt);
    expect(effective - before).toBeGreaterThanOrEqual(LIMIT_INCREASE_DELAY_MS);
    expect(effective - before).toBeLessThan(LIMIT_INCREASE_DELAY_MS + 60_000);
    // Still enforced at the old value while pending.
    expectError(
      await p.post('/api/games/roulette/spin', {
        bets: [{ type: 'red', amount: 41 * CHIP }],
        idempotencyKey: key(),
      }),
      403,
      'RG_LOSS_LIMIT',
    );

    // A new lowering cancels the pending raise.
    s = await setLimit(p, '7d', 30 * CHIP);
    expect(s.lossLimits['7d']).toMatchObject({ value: 30 * CHIP, pending: null });

    s = await setLimit(p, '7d', 60 * CHIP);
    expect(s.lossLimits['7d'].pending?.value).toBe(60 * CHIP);
    await advance(p, LIMIT_INCREASE_DELAY_MS - HOUR);
    expect((await rg(p)).lossLimits['7d'].value).toBe(30 * CHIP);
    await advance(p, HOUR + 1000);
    // Applied lazily on read.
    expect((await rg(p)).lossLimits['7d']).toMatchObject({ value: 60 * CHIP, pending: null });

    // Removal is pending too.
    s = await setLimit(p, '7d', null);
    expect(s.lossLimits['7d']).toMatchObject({
      value: 60 * CHIP,
      pending: { value: null },
    });
    await advance(p, LIMIT_INCREASE_DELAY_MS + 1000);
    // Applied lazily by the stake check as well.
    const spin = await p.post('/api/games/roulette/spin', {
      bets: [{ type: 'red', amount: 100 * CHIP }],
      idempotencyKey: key(),
    });
    expect(spin.statusCode, spin.body).toBe(200);
    expect((await rg(p)).lossLimits['7d']).toEqual(
      expect.objectContaining({ value: null, pending: null, remaining: null }),
    );
  });

  it('uses rolling windows and ignores balance resets', async () => {
    const p = await registerPlayer(env.app);
    await setInitialBalance(env.pool, p.userId, 30 * CHIP);
    await setLimit(p, '24h', 100 * CHIP);
    await loseOnRed(p, 25 * CHIP);
    const reset = await p.post('/api/wallet/reset');
    expect(reset.statusCode, reset.body).toBe(200);
    let s = await rg(p);
    expect(s.lossLimits['24h']).toMatchObject({ used: 25 * CHIP, remaining: 75 * CHIP });

    await advance(p, 25 * HOUR);
    s = await rg(p);
    expect(s.lossLimits['24h'].used).toBe(0);
    expect(s.lossLimits['7d'].used).toBe(25 * CHIP);
    expect(s.lossLimits['30d'].used).toBe(25 * CHIP);
  });

  it('counts net wins against losses and never reports negative usage', async () => {
    const p = await registerPlayer(env.app);
    await prepareNextRound(p, env.pool, (rng) => evaluateSlot(spinSlot(rng)).multiplier >= 4);
    const win = await p.post('/api/games/slot/spin', { amount: 10 * CHIP, idempotencyKey: key() });
    expect(win.statusCode).toBe(200);
    const s = await rg(p);
    expect(s.lossLimits['24h'].used).toBe(0);
  });

  it('checks doubles and splits against the limit', async () => {
    const p = await registerPlayer(env.app);
    await setLimit(p, '24h', 15 * CHIP);
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(10 * CHIP, (st) => st.phase === 'player'),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: 10 * CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();
    const dbl = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'double',
      step: 0,
    });
    // The open stake already counts as lost: 10 used + 10 > 15.
    expect(expectError(dbl, 403, 'RG_LOSS_LIMIT').details).toEqual({
      period: '24h',
      remaining: 5 * CHIP,
    });
    const stand = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'stand',
      step: 0,
    });
    expect(stand.statusCode).toBe(200);
  });

  it('validates the request', async () => {
    const p = await registerPlayer(env.app);
    expectError(
      await p.put('/api/rg/loss-limit', { period: '1y', value: CHIP }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await p.put('/api/rg/loss-limit', { period: '24h', value: 150 }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await p.put('/api/rg/loss-limit', { period: '24h', value: 0 }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('self-exclusion', () => {
  it('blocks new stakes, cannot be shortened, lets open hands finish', async () => {
    const p = await registerPlayer(env.app, 'Pausa');
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(5 * CHIP, (st) => st.phase === 'player'),
    );
    const deal = (
      await p.post('/api/games/blackjack/deal', { amount: 5 * CHIP, idempotencyKey: key() })
    ).json<BlackjackRoundResponse>();

    const start = env.clock.now().getTime();
    let res = await p.post('/api/rg/self-exclusion', { duration: '7d' });
    expect(res.statusCode, res.body).toBe(200);
    const until = res.json<RgStatus>().selfExclusion.until!;
    expect(Date.parse(until) - start).toBeGreaterThanOrEqual(SELF_EXCLUSION_MS['7d']);
    expect(Date.parse(until) - start).toBeLessThan(SELF_EXCLUSION_MS['7d'] + 60_000);

    res = await p.post('/api/rg/self-exclusion', { duration: '24h' });
    expect(res.json<RgStatus>().selfExclusion.until).toBe(until);

    const spin = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect(expectError(spin, 403, 'RG_SELF_EXCLUDED').details).toEqual({ until });
    expectError(
      await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey: key() }),
      403,
      'RG_SELF_EXCLUDED',
    );
    // No chips can be added to the open hand...
    expectError(
      await p.post('/api/games/blackjack/action', {
        roundId: deal.round.id,
        action: 'double',
        step: 0,
      }),
      403,
      'RG_SELF_EXCLUDED',
    );
    // ...but it can be completed.
    const stand = await p.post('/api/games/blackjack/action', {
      roundId: deal.round.id,
      action: 'stand',
      step: 0,
    });
    expect(stand.statusCode, stand.body).toBe(200);

    // Login and read-only pages keep working.
    const again = await loginPlayer(env.app, 'Pausa');
    expect((await again.get('/api/history')).statusCode).toBe(200);
    expect((await again.get('/api/stats')).statusCode).toBe(200);

    await advance(p, SELF_EXCLUSION_MS['7d'] - HOUR);
    const still = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expectError(still, 403, 'RG_SELF_EXCLUDED');
    await advance(p, HOUR + 60_000);
    const ok = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await rg(p)).selfExclusion.until).toBeNull();
  });

  it('extends a shorter pause', async () => {
    const p = await registerPlayer(env.app);
    const a = (await p.post('/api/rg/self-exclusion', { duration: '24h' })).json<RgStatus>();
    const b = (await p.post('/api/rg/self-exclusion', { duration: '30d' })).json<RgStatus>();
    expect(Date.parse(b.selfExclusion.until!)).toBeGreaterThan(Date.parse(a.selfExclusion.until!));
    expectError(
      await p.post('/api/rg/self-exclusion', { duration: '1h' }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('reality check and session', () => {
  it('stores the interval and reports the session', async () => {
    const p = await registerPlayer(env.app);
    let s = await rg(p);
    expect(s.realityCheckMinutes).toBe(30);
    expect(s.session).toMatchObject({ rounds: 0, net: 0 });
    const res = await p.put('/api/rg/reality-check', { minutes: 15 });
    expect(res.statusCode).toBe(200);
    expect(res.json<RgStatus>().realityCheckMinutes).toBe(15);
    expectError(await p.put('/api/rg/reality-check', { minutes: 20 }), 400, 'VALIDATION_ERROR');

    await loseOnRed(p, 3 * CHIP);
    env.clock.advance(10 * 60 * 1000);
    s = await rg(p);
    expect(s.session.rounds).toBe(1);
    expect(s.session.net).toBe(-3 * CHIP);
    expect(s.session.startedAt).toBe(p.me.sessionStartedAt);
    expect(s.session.elapsedMs).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(s.session.elapsedMs).toBeLessThan(11 * 60 * 1000);
  });
});
