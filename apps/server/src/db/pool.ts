import pg from 'pg';

// int8 (bigint, COUNT(*)) -> number: every amount and id stays within Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  // Idle clients can error (e.g. server restart); without a listener the process would crash.
  pool.on('error', () => {});
  return pool;
}
