import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashServerSeed } from '@casino/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, resolveMigrationsDir } from '../src/db/migrate.ts';
import {
  CONNECTION_TIMEOUT_MS,
  createPool,
  STATEMENT_TIMEOUT_MS,
  type Pool,
} from '../src/db/pool.ts';
import { TEST_DATABASE_URL } from './helpers.ts';

let pool: Pool;

beforeAll(() => {
  pool = createPool(TEST_DATABASE_URL, 5);
});
afterAll(async () => {
  await pool.end();
});

describe('migrations', () => {
  it('finds the migrations directory and honours MIGRATIONS_DIR', () => {
    expect(resolveMigrationsDir({})).toMatch(/apps\/server\/migrations$/);
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '/tmp/altrove' })).toBe('/tmp/altrove');
  });

  it('is idempotent and safe to run concurrently', async () => {
    const results = await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
    for (const r of results) expect(r.applied).toEqual([]);
    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual(
      expect.arrayContaining(['001_init', '002_next_server_seed']),
    );
  });

  it('rolls back a failing migration and reports it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'casino-mig-'));
    writeFileSync(join(dir, '001_init.sql'), 'SELECT 1;');
    writeFileSync(
      join(dir, '998_prova.sql'),
      'CREATE TABLE prova_rollback (id int); SELECT * FROM tabella_inesistente;',
    );
    try {
      await expect(migrate(pool, dir)).rejects.toThrow(/998_prova\.sql/);
      const table = await pool.query(`SELECT to_regclass('prova_rollback') AS t`);
      expect(table.rows[0].t).toBeNull();
      const version = await pool.query(
        `SELECT 1 FROM schema_migrations WHERE version = '998_prova'`,
      );
      expect(version.rowCount).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lifts the pool statement timeout while migrating, then restores it', async () => {
    const single = createPool(TEST_DATABASE_URL, 1);
    const dir = mkdtempSync(join(tmpdir(), 'casino-mig-'));
    writeFileSync(
      join(dir, '997_timeout.sql'),
      `CREATE TABLE prova_timeout AS SELECT current_setting('statement_timeout') AS t;`,
    );
    const timeout = async () =>
      (await single.query<{ t: string }>(`SELECT current_setting('statement_timeout') AS t`))
        .rows[0]!.t;
    try {
      expect(single.options.connectionTimeoutMillis).toBe(CONNECTION_TIMEOUT_MS);
      expect(await timeout()).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
      expect((await migrate(single, dir)).applied).toEqual(['997_timeout']);
      const during = await single.query<{ t: string }>('SELECT t FROM prova_timeout');
      expect(during.rows[0]!.t).toBe('0');
      // The pool has a single connection: the migrator's one is back to the default.
      expect(await timeout()).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
    } finally {
      await single.query('DROP TABLE IF EXISTS prova_timeout');
      await single.query(`DELETE FROM schema_migrations WHERE version = '997_timeout'`);
      await single.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('002 backfills a pre-committed next server seed for existing users', async () => {
    // A scratch schema holds a database migrated to 001 only, with users already registered.
    const schema = `mig_next_seed_${process.pid}`;
    const url = new URL(TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const scoped = createPool(url.toString(), 1);
    const dir = mkdtempSync(join(tmpdir(), 'casino-mig-'));
    const source = resolveMigrationsDir();
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      copyFileSync(join(source, '001_init.sql'), join(dir, '001_init.sql'));
      expect((await migrate(scoped, dir)).applied).toEqual(['001_init']);
      await scoped.query(
        `INSERT INTO users (username, password_hash, age_confirmed_at)
         VALUES ('primo', 'scrypt$x', now()), ('secondo', 'scrypt$x', now())`,
      );

      copyFileSync(join(source, '002_next_server_seed.sql'), join(dir, '002_next_server_seed.sql'));
      expect((await migrate(scoped, dir)).applied).toEqual(['002_next_server_seed']);
      const { rows } = await scoped.query<{
        user_id: number;
        server_seed: string;
        server_seed_hash: string;
      }>('SELECT user_id, server_seed, server_seed_hash FROM next_server_seeds ORDER BY user_id');
      expect(rows.map((r) => r.user_id)).toEqual([1, 2]);
      for (const r of rows) {
        expect(r.server_seed).toMatch(/^[0-9a-f]{64}$/);
        expect(r.server_seed_hash).toBe(hashServerSeed(r.server_seed));
      }
      expect(rows[0]!.server_seed).not.toBe(rows[1]!.server_seed);

      // One next seed per user, deleted with the account.
      await expect(
        scoped.query(
          `INSERT INTO next_server_seeds (user_id, server_seed, server_seed_hash)
           VALUES (1, repeat('a', 64), repeat('b', 64))`,
        ),
      ).rejects.toThrow(/duplicate key/);
      await scoped.query('DELETE FROM users WHERE id = 1');
      const left = await scoped.query('SELECT user_id FROM next_server_seeds');
      expect(left.rows).toEqual([{ user_id: 2 }]);
    } finally {
      await scoped.end();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces the schema constraints', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (username, password_hash, age_confirmed_at) VALUES ('ab', 'scrypt$x', now())`,
      ),
    ).rejects.toThrow(/check/i);
  });
});
