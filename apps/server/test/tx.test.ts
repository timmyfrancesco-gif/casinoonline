import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from '../src/db/pool.ts';
import { withTransaction, withUserTransaction } from '../src/db/tx.ts';
import { TEST_DATABASE_URL } from './helpers.ts';

/** In-memory pool: counts the connections held and records the statements. */
function fakePool() {
  const state = { held: 0, maxHeld: 0, statements: [] as string[] };
  const pool = {
    connect: async () => {
      state.held++;
      state.maxHeld = Math.max(state.maxHeld, state.held);
      return {
        query: async (sql: string) => {
          state.statements.push(sql);
          return { rows: [], rowCount: 0 };
        },
        release: () => {
          state.held--;
        },
      } as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool, state };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets pending promise callbacks (and fake queries) run. */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('withUserTransaction', () => {
  it('runs one user’s transactions in order, one at a time, without holding a connection while waiting', async () => {
    const { pool, state } = fakePool();
    const events: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const runs = gates.map((gate, i) =>
      withUserTransaction(pool, 1, async () => {
        events.push(`start ${i}`);
        await gate.promise;
        events.push(`end ${i}`);
        if (i === 0) throw new Error('il primo fallisce');
        return i;
      }),
    );
    await settle();
    expect(events).toEqual(['start 0']);
    // The queued transactions have not taken a pool connection.
    expect(state.held).toBe(1);

    gates[2]!.resolve();
    gates[1]!.resolve();
    await settle();
    expect(events).toEqual(['start 0']);

    gates[0]!.resolve();
    // A failing holder does not block the next ones.
    await expect(runs[0]).rejects.toThrow('il primo fallisce');
    expect(await runs[1]).toBe(1);
    expect(await runs[2]).toBe(2);
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2']);
    expect(state.maxHeld).toBe(1);
    expect(state.held).toBe(0);
  });

  it('runs different users’ transactions concurrently', async () => {
    const { pool, state } = fakePool();
    const gate = deferred();
    const events: string[] = [];
    const first = withUserTransaction(pool, 1, async () => {
      events.push('start 1');
      await gate.promise;
      events.push('end 1');
    });
    const second = withUserTransaction(pool, 2, async () => {
      events.push('start 2');
      events.push('end 2');
    });
    await second;
    expect(events).toEqual(['start 1', 'start 2', 'end 2']);
    expect(state.maxHeld).toBe(2);
    gate.resolve();
    await first;
    expect(events).toEqual(['start 1', 'start 2', 'end 2', 'end 1']);

    // Once idle, the same user can start again right away.
    expect(await withUserTransaction(pool, 1, async () => 'ancora')).toBe('ancora');
    expect(state.held).toBe(0);
  });
});

describe('withTransaction', () => {
  it('runs at READ COMMITTED whatever the database default is', async () => {
    const { pool: fake, state } = fakePool();
    await withTransaction(fake, async () => {});
    expect(state.statements[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');

    const pool = new pg.Pool({
      connectionString: TEST_DATABASE_URL,
      max: 1,
      options: '-c default_transaction_isolation=serializable',
    });
    try {
      const outside = await pool.query<{ level: string }>(
        "SELECT current_setting('transaction_isolation') AS level",
      );
      expect(outside.rows[0]!.level).toBe('serializable');
      const inside = await withTransaction(pool, (client) =>
        client.query<{ level: string }>("SELECT current_setting('transaction_isolation') AS level"),
      );
      expect(inside.rows[0]!.level).toBe('read committed');
    } finally {
      await pool.end();
    }
  });
});
