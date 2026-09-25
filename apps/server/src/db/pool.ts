import pg from 'pg';

// int8 (bigint, COUNT(*)) -> number: every amount and id stays within Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

/** A request waiting longer than this for a free connection fails instead of queuing forever. */
export const CONNECTION_TIMEOUT_MS = 10_000;
/** Server-side cap on a single statement (lock waits included); migrations lift it. */
export const STATEMENT_TIMEOUT_MS = 15_000;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  // Idle clients can error (e.g. server restart); without a listener the process would crash.
  pool.on('error', () => {});
  return pool;
}
