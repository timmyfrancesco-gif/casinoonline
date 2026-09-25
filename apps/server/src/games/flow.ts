import { createRoundRng, type GameId, type Rng } from '@casino/engine';
import type { AppContext } from '../context.ts';
import type { PoolClient } from '../db/pool.ts';
import { withUserTransaction } from '../db/tx.ts';
import { apiError } from '../lib/errors.ts';
import { canonicalJson, sha256Hex } from '../lib/util.ts';
import { takeNonce } from '../services/fairness.ts';
import { assertLossLimits } from '../services/rg.ts';
import {
  applyMovement,
  assertNotSelfExcluded,
  assertSufficientFunds,
  getBalance,
  lockUser,
  type LockedUser,
} from '../services/wallet.ts';
import { lockRound, ROUND_SELECT, type RoundRow } from './rounds.ts';

/** sha256 of the canonical body, bound to the endpoint (a key reused elsewhere is a conflict). */
export function requestHash(endpoint: string, body: unknown): string {
  return sha256Hex(canonicalJson({ endpoint, body }));
}

export interface PlayResult {
  state: unknown;
  settled: boolean;
  /** Total returned (stake included); only credited when the round is settled. */
  payout: number;
}

export interface StakeFlow<R> {
  userId: number;
  game: GameId;
  idempotencyKey: string;
  requestHash: string;
  /** Total stake debited when the round starts. */
  stake: number;
  input: unknown;
  /** Table limits / bet layout checks (throw BET_LIMIT). */
  checkBet: () => void;
  /** Runs the engine with the round RNG. */
  play: (rng: Rng) => PlayResult;
  respond: (row: RoundRow, balance: number) => R;
}

async function findByIdempotencyKey(
  client: PoolClient,
  userId: number,
  key: string,
): Promise<RoundRow | null> {
  const { rows } = await client.query<RoundRow>(
    `${ROUND_SELECT} WHERE r.user_id = $1 AND r.idempotency_key = $2`,
    [userId, key],
  );
  return rows[0] ?? null;
}

/** Balance right after the latest ledger movement of a round (for idempotent replays). */
async function balanceAfterRound(client: PoolClient, roundId: number): Promise<number> {
  const { rows } = await client.query<{ balance_after: number }>(
    'SELECT balance_after FROM ledger WHERE round_id = $1 ORDER BY id DESC LIMIT 1',
    [roundId],
  );
  return rows[0]!.balance_after;
}

async function selectRound(client: PoolClient, roundId: number): Promise<RoundRow> {
  const { rows } = await client.query<RoundRow>(`${ROUND_SELECT} WHERE r.id = $1`, [roundId]);
  return rows[0]!;
}

/**
 * Starts a round (SPEC §3): user lock, idempotency, RG/limit/funds checks, nonce, engine,
 * round + ledger writes, all in one transaction.
 */
export async function runStake<R>(ctx: AppContext, flow: StakeFlow<R>): Promise<R> {
  return withUserTransaction(ctx.pool, flow.userId, async (client) => {
    const now = ctx.now();
    const user = await lockUser(client, flow.userId);

    const existing = await findByIdempotencyKey(client, flow.userId, flow.idempotencyKey);
    if (existing) {
      if (existing.request_hash !== flow.requestHash) {
        throw apiError(
          'CONFLICT',
          'Questa chiave di idempotenza è già stata usata per una richiesta diversa.',
        );
      }
      return flow.respond(existing, await balanceAfterRound(client, existing.id));
    }

    assertNotSelfExcluded(user, now);
    flow.checkBet();
    const open = await client.query<{ id: number }>(
      `SELECT id FROM rounds WHERE user_id = $1 AND game = $2 AND status = 'open'`,
      [flow.userId, flow.game],
    );
    if (open.rows[0]) {
      throw apiError('ROUND_ALREADY_OPEN', undefined, { roundId: String(open.rows[0].id) });
    }
    assertSufficientFunds(await getBalance(client, flow.userId), flow.stake);
    await assertLossLimits(client, flow.userId, flow.stake, now);

    const { pair, nonce } = await takeNonce(client, flow.userId);
    const result = flow.play(
      createRoundRng({ serverSeed: pair.server_seed, clientSeed: pair.client_seed, nonce }),
    );
    const payout = result.settled ? result.payout : 0;
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO rounds (user_id, game, status, seed_pair_id, nonce, stake, payout, input, state,
                           idempotency_key, request_hash, created_at, settled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
       RETURNING id`,
      [
        flow.userId,
        flow.game,
        result.settled ? 'settled' : 'open',
        pair.id,
        nonce,
        flow.stake,
        payout,
        JSON.stringify(flow.input),
        JSON.stringify(result.state),
        flow.idempotencyKey,
        flow.requestHash,
        now,
        result.settled ? now : null,
      ],
    );
    const roundId = inserted.rows[0]!.id;
    let balance = await applyMovement(client, {
      userId: flow.userId,
      roundId,
      kind: 'stake',
      amount: -flow.stake,
      now,
    });
    if (payout > 0) {
      balance = await applyMovement(client, {
        userId: flow.userId,
        roundId,
        kind: 'payout',
        amount: payout,
        now,
      });
    }
    return flow.respond(await selectRound(client, roundId), balance);
  });
}

export interface StepContext {
  client: PoolClient;
  user: LockedUser;
  row: RoundRow;
  balance: number;
  now: Date;
}

export interface StepResult {
  state: unknown;
  input: unknown;
  settled: boolean;
  payout: number;
  /** Extra stake debited by this step (double/split). */
  extraStake: number;
}

/**
 * One step of a multi-step round (SPEC §3): user lock, round lock, ROUND_NOT_OPEN / stale-step
 * CONFLICT (details.round = current response), then `apply` computes the transition (it may
 * throw ILLEGAL_ACTION / BET_LIMIT / RG errors before anything is written).
 */
export async function runStep<R>(
  ctx: AppContext,
  opts: {
    userId: number;
    game: GameId;
    roundId: number | null;
    step: number;
    currentStep: (row: RoundRow) => number;
    respond: (row: RoundRow, balance: number) => R;
    apply: (step: StepContext) => Promise<StepResult>;
  },
): Promise<R> {
  return withUserTransaction(ctx.pool, opts.userId, async (client) => {
    const now = ctx.now();
    const user = await lockUser(client, opts.userId);
    const row = opts.roundId === null ? null : await lockRound(client, opts.userId, opts.roundId);
    if (!row || row.game !== opts.game) throw apiError('ROUND_NOT_OPEN');
    const balance = await getBalance(client, opts.userId);
    if (row.status !== 'open') {
      throw apiError('ROUND_NOT_OPEN', 'Questa mano è già conclusa.', {
        round: opts.respond(row, balance),
      });
    }
    if (opts.currentStep(row) !== opts.step) {
      throw apiError('CONFLICT', 'La mano è cambiata nel frattempo: stato aggiornato.', {
        round: opts.respond(row, balance),
      });
    }

    const result = await opts.apply({ client, user, row, balance, now });
    let newBalance = balance;
    if (result.extraStake > 0) {
      newBalance = await applyMovement(client, {
        userId: opts.userId,
        roundId: row.id,
        kind: 'stake',
        amount: -result.extraStake,
        now,
      });
    }
    const payout = result.settled ? result.payout : 0;
    if (payout > 0) {
      newBalance = await applyMovement(client, {
        userId: opts.userId,
        roundId: row.id,
        kind: 'payout',
        amount: payout,
        now,
      });
    }
    await client.query(
      `UPDATE rounds
          SET state = $2::jsonb, input = $3::jsonb, stake = stake + $4, payout = $5,
              status = $6, settled_at = $7
        WHERE id = $1`,
      [
        row.id,
        JSON.stringify(result.state),
        JSON.stringify(result.input),
        result.extraStake,
        payout,
        result.settled ? 'settled' : 'open',
        result.settled ? now : null,
      ],
    );
    return opts.respond(await selectRound(client, row.id), newBalance);
  });
}
