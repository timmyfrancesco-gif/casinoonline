import type { Pool, PoolClient } from './pool.ts';

/**
 * Runs fn inside BEGIN/COMMIT at READ COMMITTED (set explicitly: idempotent replays and bets
 * waiting on the user lock rely on each statement seeing the rows committed while they waited,
 * whatever the database default is); rolls back on any error.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    // A client whose rollback failed is in an unknown state: destroy it.
    client.release(broken);
  }
}

/** Tail of each user's queue of money transactions in this process. */
const userQueues = new Map<number, Promise<void>>();

/**
 * withTransaction for an operation that takes the user lock (lockUser). The user's transactions
 * run one at a time in this process and each waits for its turn BEFORE taking a pool connection:
 * a burst of requests from one user queues here instead of holding every connection while blocked
 * on the same row lock, which would stall every other user. lockUser stays the guarantee across
 * server instances.
 */
export async function withUserTransaction<T>(
  pool: Pool,
  userId: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  userQueues.set(userId, current);
  try {
    // `previous` never rejects: it is resolved in the previous holder's finally.
    await previous;
    return await withTransaction(pool, fn);
  } finally {
    release();
    if (userQueues.get(userId) === current) userQueues.delete(userId);
  }
}
