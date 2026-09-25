import { formatChips } from '@casino/engine';
import {
  LIMIT_INCREASE_DELAY_MS,
  LOSS_LIMIT_PERIODS,
  LOSS_LIMIT_PERIOD_MS,
  SELF_EXCLUSION_MS,
  type LossLimitPeriod,
  type LossLimitState,
  type RealityCheckMinutes,
  type RgStatus,
  type SelfExclusionDuration,
} from '@casino/shared';
import type { PoolClient, Queryable } from '../db/pool.ts';
import { apiError } from '../lib/errors.ts';
import { settledStats } from './stats.ts';

export const PERIOD_LABELS_IT: Record<LossLimitPeriod, string> = {
  '24h': 'ultime 24 ore',
  '7d': 'ultimi 7 giorni',
  '30d': 'ultimi 30 giorni',
};

interface LimitRow {
  period: LossLimitPeriod;
  value: number | null;
  pending_set: boolean;
  pending_value: number | null;
  pending_effective_at: Date | null;
}

type Limits = Record<LossLimitPeriod, LimitRow>;

/** Lazily applies raises/removals whose cooling-off period has elapsed. */
async function applyDuePending(db: Queryable, userId: number, now: Date): Promise<void> {
  await db.query(
    `UPDATE loss_limits
        SET value = pending_value, pending_set = false, pending_value = NULL,
            pending_effective_at = NULL
      WHERE user_id = $1 AND pending_set AND pending_effective_at <= $2`,
    [userId, now],
  );
}

async function loadLimits(db: Queryable, userId: number, now: Date, lock = false): Promise<Limits> {
  await applyDuePending(db, userId, now);
  const { rows } = await db.query<LimitRow>(
    `SELECT period, value, pending_set, pending_value, pending_effective_at
       FROM loss_limits WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const limits = {} as Limits;
  for (const period of LOSS_LIMIT_PERIODS) {
    limits[period] = rows.find((r) => r.period === period) ?? {
      period,
      value: null,
      pending_set: false,
      pending_value: null,
      pending_effective_at: null,
    };
  }
  return limits;
}

/** used(period) = max(0, -SUM(stake+payout movements in the rolling window)); resets excluded. */
export async function lossUsed(
  db: Queryable,
  userId: number,
  now: Date,
): Promise<Record<LossLimitPeriod, number>> {
  const since = (p: LossLimitPeriod) => new Date(now.getTime() - LOSS_LIMIT_PERIOD_MS[p]);
  const { rows } = await db.query<{ d24h: number; d7d: number; d30d: number }>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE created_at > $2), 0)::bigint AS d24h,
            COALESCE(SUM(amount) FILTER (WHERE created_at > $3), 0)::bigint AS d7d,
            COALESCE(SUM(amount), 0)::bigint AS d30d
       FROM ledger
      WHERE user_id = $1 AND kind IN ('stake', 'payout') AND created_at > $4`,
    [userId, since('24h'), since('7d'), since('30d')],
  );
  const row = rows[0] ?? { d24h: 0, d7d: 0, d30d: 0 };
  return {
    '24h': Math.max(0, -row.d24h),
    '7d': Math.max(0, -row.d7d),
    '30d': Math.max(0, -row.d30d),
  };
}

/**
 * Rejects a new stake (or double/split) of `stake` units when used + stake > value for any
 * period (conservative: the stake is assumed lost). Caller holds the user lock.
 */
export async function assertLossLimits(
  client: PoolClient,
  userId: number,
  stake: number,
  now: Date,
): Promise<void> {
  const limits = await loadLimits(client, userId, now);
  const withValue = LOSS_LIMIT_PERIODS.filter((p) => limits[p].value !== null);
  if (withValue.length === 0) return;
  const used = await lossUsed(client, userId, now);
  let worst: { period: LossLimitPeriod; remaining: number } | null = null;
  for (const period of withValue) {
    const remaining = Math.max(0, limits[period].value! - used[period]);
    if (used[period] + stake > limits[period].value!) {
      if (worst === null || remaining < worst.remaining) worst = { period, remaining };
    }
  }
  if (worst !== null) {
    throw apiError(
      'RG_LOSS_LIMIT',
      `La puntata supererebbe il tuo limite di perdita (${PERIOD_LABELS_IT[worst.period]}): ` +
        `puoi ancora puntare al massimo ${formatChips(worst.remaining)} fiches.`,
      worst,
    );
  }
}

/**
 * Lowering (or setting where there was none) is immediate and cancels any pending change;
 * raising or removing becomes pending for LIMIT_INCREASE_DELAY_MS. Caller holds the user lock.
 */
export async function setLossLimit(
  client: PoolClient,
  userId: number,
  period: LossLimitPeriod,
  value: number | null,
  now: Date,
): Promise<void> {
  const limits = await loadLimits(client, userId, now, true);
  const current = limits[period].value;
  let row: Omit<LimitRow, 'period'>;
  if (value !== null && (current === null || value <= current)) {
    row = { value, pending_set: false, pending_value: null, pending_effective_at: null };
  } else if (value === null && current === null) {
    row = { value: null, pending_set: false, pending_value: null, pending_effective_at: null };
  } else {
    row = {
      value: current,
      pending_set: true,
      pending_value: value,
      pending_effective_at: new Date(now.getTime() + LIMIT_INCREASE_DELAY_MS),
    };
  }
  await client.query(
    `INSERT INTO loss_limits (user_id, period, value, pending_set, pending_value, pending_effective_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, period) DO UPDATE
       SET value = EXCLUDED.value, pending_set = EXCLUDED.pending_set,
           pending_value = EXCLUDED.pending_value,
           pending_effective_at = EXCLUDED.pending_effective_at`,
    [userId, period, row.value, row.pending_set, row.pending_value, row.pending_effective_at],
  );
}

/** until = max(current, now + duration): a pause can never be shortened. */
export async function extendSelfExclusion(
  client: PoolClient,
  userId: number,
  duration: SelfExclusionDuration,
  now: Date,
): Promise<void> {
  const until = new Date(now.getTime() + SELF_EXCLUSION_MS[duration]);
  await client.query(
    `UPDATE users SET self_excluded_until = GREATEST(COALESCE(self_excluded_until, $2), $2)
      WHERE id = $1`,
    [userId, until],
  );
}

export async function setRealityCheck(
  db: Queryable,
  userId: number,
  minutes: RealityCheckMinutes,
): Promise<void> {
  await db.query('UPDATE users SET reality_check_minutes = $2 WHERE id = $1', [userId, minutes]);
}

export async function rgStatus(
  db: Queryable,
  userId: number,
  sessionStartedAt: Date,
  now: Date,
): Promise<RgStatus> {
  const limits = await loadLimits(db, userId, now);
  const used = await lossUsed(db, userId, now);
  const { rows } = await db.query<{
    self_excluded_until: Date | null;
    reality_check_minutes: RealityCheckMinutes;
  }>('SELECT self_excluded_until, reality_check_minutes FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw apiError('UNAUTHENTICATED');
  const session = await settledStats(db, userId, sessionStartedAt);
  const lossLimits = {} as Record<LossLimitPeriod, LossLimitState>;
  for (const period of LOSS_LIMIT_PERIODS) {
    const l = limits[period];
    lossLimits[period] = {
      value: l.value,
      pending: l.pending_set
        ? { value: l.pending_value, effectiveAt: l.pending_effective_at!.toISOString() }
        : null,
      used: used[period],
      remaining: l.value === null ? null : Math.max(0, l.value - used[period]),
    };
  }
  const until = user.self_excluded_until;
  return {
    lossLimits,
    selfExclusion: {
      until: until !== null && until.getTime() > now.getTime() ? until.toISOString() : null,
    },
    realityCheckMinutes: user.reality_check_minutes,
    session: {
      startedAt: sessionStartedAt.toISOString(),
      elapsedMs: Math.max(0, now.getTime() - sessionStartedAt.getTime()),
      rounds: session.total.rounds,
      net: session.total.net,
    },
  };
}
