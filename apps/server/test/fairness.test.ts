import {
  blackjackBasicStrategy,
  blackjackPublicView,
  hashServerSeed,
  verifyRound,
  verifyServerSeedHash,
  videoPokerHoldAnalysis,
  videoPokerPublicView,
  type BlackjackState,
  type VideoPokerState,
} from '@casino/engine';
import type {
  BlackjackRoundResponse,
  FairnessResponse,
  RoundDetailResponse,
  VideoPokerRoundResponse,
} from '@casino/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getFairness } from '../src/services/fairness.ts';
import {
  blackjackDealWith,
  CHIP,
  createTestEnv,
  expectError,
  key,
  prepareNextRound,
  registerPlayer,
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

async function fairness(p: Player): Promise<FairnessResponse> {
  const res = await p.get('/api/fairness');
  expect(res.statusCode, res.body).toBe(200);
  return res.json<FairnessResponse>();
}

async function playBlackjack(p: Player, amount: number): Promise<void> {
  let bj = (
    await p.post('/api/games/blackjack/deal', { amount, idempotencyKey: key() })
  ).json<BlackjackRoundResponse>();
  while (bj.state.phase === 'player') {
    // Basic strategy exercises hits, stands, doubles and splits.
    const action = blackjackBasicStrategy(bj.state) ?? 'stand';
    const res = await p.post('/api/games/blackjack/action', {
      roundId: bj.round.id,
      action,
      step: bj.state.step,
    });
    expect(res.statusCode, res.body).toBe(200);
    bj = res.json<BlackjackRoundResponse>();
  }
}

async function playVideoPoker(p: Player): Promise<void> {
  const vp = (
    await p.post('/api/games/videopoker/deal', { amount: 2 * CHIP, idempotencyKey: key() })
  ).json<VideoPokerRoundResponse>();
  const held = videoPokerHoldAnalysis(vp.state.hand)[0]!.held;
  const res = await p.post('/api/games/videopoker/draw', { roundId: vp.round.id, held, step: 0 });
  expect(res.statusCode, res.body).toBe(200);
}

describe('seed pairs', () => {
  it('shows only the hash of the active server seed', async () => {
    const p = await registerPlayer(env.app);
    const f = await fairness(p);
    expect(f.revealed).toEqual([]);
    expect(f.active.nextNonce).toBe(0);
    const { rows } = await env.pool.query(
      'SELECT server_seed FROM seed_pairs WHERE user_id = $1 AND active',
      [p.userId],
    );
    expect(f.active.serverSeedHash).toBe(hashServerSeed(rows[0].server_seed));
    const raw = JSON.stringify(await p.get('/api/fairness').then((r) => r.json()));
    expect(raw).not.toContain(rows[0].server_seed);

    const spin = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect(spin.body).not.toContain(rows[0].server_seed);
    expect((await fairness(p)).active.nextNonce).toBe(1);
  });

  it('answers 401 for an account deleted after authentication, not 500', async () => {
    const p = await registerPlayer(env.app);
    await env.pool.query('DELETE FROM users WHERE id = $1', [p.userId]);
    await expect(getFairness(env.pool, p.userId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });

  it('rotation is blocked while a round is open', async () => {
    const p = await registerPlayer(env.app);
    const deal = await p.post('/api/games/videopoker/deal', {
      amount: CHIP,
      idempotencyKey: key(),
    });
    const res = await p.post('/api/fairness/rotate', {});
    const err = expectError(res, 409, 'SEED_ROTATION_BLOCKED');
    expect(err.details).toEqual({ roundId: deal.json().round.id });
  });

  it('rotation reveals the old pair and uses the chosen client seed', async () => {
    const p = await registerPlayer(env.app);
    const before = await fairness(p);
    await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expectError(
      await p.post('/api/fairness/rotate', { clientSeed: 'con spazio' }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await p.post('/api/fairness/rotate', { clientSeed: 'a:b' }),
      400,
      'VALIDATION_ERROR',
    );
    const res = await p.post('/api/fairness/rotate', { clientSeed: 'fortuna-42' });
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json<FairnessResponse>();
    expect(after.active.clientSeed).toBe('fortuna-42');
    expect(after.active.nextNonce).toBe(0);
    expect(after.active.id).not.toBe(before.active.id);
    expect(after.revealed).toHaveLength(1);
    const revealed = after.revealed[0]!;
    expect(revealed.id).toBe(before.active.id);
    expect(revealed.roundsPlayed).toBe(2);
    expect(revealed.clientSeed).toBe(before.active.clientSeed);
    expect(verifyServerSeedHash(revealed.serverSeed, before.active.serverSeedHash)).toBe(true);

    // Random client seed when omitted (also with an empty body).
    const again = (await p.post('/api/fairness/rotate')).json<FairnessResponse>();
    expect(again.active.clientSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(again.revealed.map((r) => r.id)).toEqual([after.active.id, before.active.id]);
  });
});

describe('pre-committed next server seed', () => {
  async function nextSeedRow(userId: number) {
    const { rows } = await env.pool.query<{ server_seed: string; server_seed_hash: string }>(
      'SELECT server_seed, server_seed_hash FROM next_server_seeds WHERE user_id = $1',
      [userId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it('is created at registration and only its hash is shown', async () => {
    const p = await registerPlayer(env.app);
    const f = await fairness(p);
    const next = await nextSeedRow(p.userId);
    expect(next.server_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(f.next.serverSeedHash).toBe(hashServerSeed(next.server_seed));
    expect(f.next.serverSeedHash).not.toBe(f.active.serverSeedHash);
    expect(JSON.stringify(f)).not.toContain(next.server_seed);
    const spin = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect(spin.body).not.toContain(next.server_seed);
  });

  it('becomes the active server seed on rotation: new active hash = previously shown next hash', async () => {
    const p = await registerPlayer(env.app);
    const before = await fairness(p);
    const committed = await nextSeedRow(p.userId);

    const res = await p.post('/api/fairness/rotate', {
      clientSeed: 'scelto-dopo-il-commit',
      nextServerSeedHash: before.next.serverSeedHash,
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json<FairnessResponse>();
    expect(after.active.serverSeedHash).toBe(before.next.serverSeedHash);
    expect(after.active.clientSeed).toBe('scelto-dopo-il-commit');
    const { rows } = await env.pool.query<{ server_seed: string }>(
      'SELECT server_seed FROM seed_pairs WHERE user_id = $1 AND active',
      [p.userId],
    );
    expect(rows[0]!.server_seed).toBe(committed.server_seed);
    // A fresh next seed is committed at once, and it is not the one just promoted.
    expect(after.next.serverSeedHash).not.toBe(before.next.serverSeedHash);
    expect(after.next.serverSeedHash).toBe(
      hashServerSeed((await nextSeedRow(p.userId)).server_seed),
    );
    expect(after).toEqual(await fairness(p));

    // Once revealed, the promoted seed opens the commitment shown before its client seed existed.
    await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    const later = (await p.post('/api/fairness/rotate', {})).json<FairnessResponse>();
    expect(later.active.serverSeedHash).toBe(after.next.serverSeedHash);
    const revealed = later.revealed.find((r) => r.id === after.active.id)!;
    expect(revealed.serverSeed).toBe(committed.server_seed);
    expect(verifyServerSeedHash(revealed.serverSeed, before.next.serverSeedHash)).toBe(true);
  });

  it('rejects a rotation bound to a stale next hash and changes nothing', async () => {
    const p = await registerPlayer(env.app);
    const seen = await fairness(p);
    // Another tab rotates in the meantime.
    expect((await p.post('/api/fairness/rotate', {})).statusCode).toBe(200);
    const current = await fairness(p);

    expectError(
      await p.post('/api/fairness/rotate', {
        clientSeed: 'troppo-tardi',
        nextServerSeedHash: seen.next.serverSeedHash,
      }),
      409,
      'CONFLICT',
    );
    expect(await fairness(p)).toEqual(current);
    expectError(
      await p.post('/api/fairness/rotate', { nextServerSeedHash: 'A'.repeat(64) }),
      400,
      'VALIDATION_ERROR',
    );
    expect(await fairness(p)).toEqual(current);
  });
});

describe('verification after rotation', () => {
  it('every previous round re-verifies with verifyRound()', async () => {
    const p = await registerPlayer(env.app);
    // A prepared split so that multi-action blackjack rounds are covered for sure.
    await prepareNextRound(
      p,
      env.pool,
      blackjackDealWith(
        10 * CHIP,
        (s) =>
          s.phase === 'player' &&
          s.hands[0]!.cards[0]! % 13 === 7 &&
          s.hands[0]!.cards[1]! % 13 === 7,
      ),
    );
    await playBlackjack(p, 10 * CHIP);
    for (let i = 0; i < 3; i++) {
      await p.post('/api/games/roulette/spin', {
        bets: [
          { type: 'straight', numbers: [i], amount: CHIP },
          { type: 'street', numbers: [4, 5, 6], amount: 2 * CHIP },
          { type: 'low', amount: 5 * CHIP },
        ],
        idempotencyKey: key(),
      });
      await p.post('/api/games/slot/spin', { amount: 3 * CHIP, idempotencyKey: key() });
      await playBlackjack(p, 5 * CHIP);
      await playVideoPoker(p);
    }
    // Before the reveal: no server seed anywhere, verify inputs available.
    const beforeHistory = (await p.get('/api/history?limit=100')).json();
    expect(beforeHistory.items.length).toBeGreaterThan(10);
    const sample = (
      await p.get(`/api/history/${beforeHistory.items[0].id}`)
    ).json<RoundDetailResponse>();
    expect(sample.round.fairness.serverSeed).toBeNull();
    expect(sample.verifyInput).not.toBeNull();

    const rotated = await p.post('/api/fairness/rotate', {});
    expect(rotated.statusCode, rotated.body).toBe(200);
    const revealedIds = new Set(rotated.json<FairnessResponse>().revealed.map((r) => r.id));

    const { rows } = await env.pool.query<{
      id: number;
      game: string;
      state: unknown;
      stake: number;
      payout: number;
    }>('SELECT id, game, state, stake, payout FROM rounds WHERE user_id = $1 ORDER BY id', [
      p.userId,
    ]);
    expect(rows.length).toBe(beforeHistory.items.length);
    let multiActionBlackjack = 0;
    for (const row of rows) {
      const res = await p.get(`/api/history/${row.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const detail = res.json<RoundDetailResponse>();
      const f = detail.round.fairness;
      expect(revealedIds.has(f.seedPairId)).toBe(true);
      expect(f.serverSeed).not.toBeNull();
      expect(verifyServerSeedHash(f.serverSeed!, f.serverSeedHash)).toBe(true);
      const result = verifyRound(
        { serverSeed: f.serverSeed!, clientSeed: f.clientSeed, nonce: f.nonce },
        detail.verifyInput!,
      );
      expect(result.game).toBe(row.game);
      switch (result.game) {
        case 'roulette':
        case 'slot':
          expect(result.settlement).toEqual(row.state);
          expect(detail.detail).toMatchObject({ settlement: result.settlement });
          break;
        case 'blackjack': {
          expect(result.state).toEqual(row.state as BlackjackState);
          expect(result.state.result!.totalPayout).toBe(row.payout);
          expect(result.state.result!.totalBet).toBe(row.stake);
          expect(detail.detail).toMatchObject({ state: blackjackPublicView(result.state) });
          if (result.state.actions.length > 1) multiActionBlackjack++;
          break;
        }
        case 'videopoker':
          expect(result.state).toEqual(row.state as VideoPokerState);
          expect(result.state.result!.payout).toBe(row.payout);
          expect(detail.detail).toMatchObject({ state: videoPokerPublicView(result.state) });
          break;
      }
    }
    expect(multiActionBlackjack).toBeGreaterThanOrEqual(1);
  });
});
