import type { PoolClient, Queryable } from '../db/pool.ts';
import { apiError } from '../lib/errors.ts';

export type LedgerKind = 'initial' | 'stake' | 'payout' | 'reset';

export interface Movement {
  userId: number;
  roundId: number | null;
  kind: LedgerKind;
  /** Negative for 'stake', positive otherwise. */
  amount: number;
  now: Date;
}

/**
 * Appends one ledger row and updates the wallet atomically (single statement), returning the
 * new balance. Must run inside a transaction that holds the user row lock (lockUser) so that
 * balance_after is consistent row by row. A negative balance violates the wallets CHECK.
 */
export async function applyMovement(client: PoolClient, m: Movement): Promise<number> {
  const { rows } = await client.query<{ balance_after: number }>(
    `WITH w AS (
       UPDATE wallets SET balance = balance + $2, updated_at = $3
        WHERE user_id = $1
        RETURNING balance
     )
     INSERT INTO ledger (user_id, round_id, kind, amount, balance_after, created_at)
     SELECT $1, $4, $5, $2, w.balance, $3 FROM w
     RETURNING balance_after`,
    [m.userId, m.amount, m.now, m.roundId, m.kind],
  );
  const row = rows[0];
  if (!row) throw new Error(`Portafoglio mancante per l'utente ${m.userId}`);
  return row.balance_after;
}

export async function getBalance(db: Queryable, userId: number): Promise<number> {
  const { rows } = await db.query<{ balance: number }>(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) throw apiError('UNAUTHENTICATED');
  return row.balance;
}

export interface LockedUser {
  id: number;
  self_excluded_until: Date | null;
}

/** SELECT ... FOR UPDATE on the user row: serialises every money operation of the user. */
export async function lockUser(client: PoolClient, userId: number): Promise<LockedUser> {
  const { rows } = await client.query<LockedUser>(
    'SELECT id, self_excluded_until FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const row = rows[0];
  if (!row) throw apiError('UNAUTHENTICATED');
  return row;
}

export function assertNotSelfExcluded(user: LockedUser, now: Date): void {
  const until = user.self_excluded_until;
  if (until !== null && until.getTime() > now.getTime()) {
    throw apiError(
      'RG_SELF_EXCLUDED',
      `Pausa attiva fino al ${formatItalianDateTime(until)}: non puoi puntare fino ad allora.`,
      { until: until.toISOString() },
    );
  }
}

export function assertSufficientFunds(balance: number, required: number): void {
  if (balance < required) {
    throw apiError('INSUFFICIENT_FUNDS', undefined, { balance, required });
  }
}

export function formatItalianDateTime(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Rome',
  }).format(date);
}
