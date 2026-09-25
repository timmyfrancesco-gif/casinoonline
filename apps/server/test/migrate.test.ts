import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, resolveMigrationsDir } from '../src/db/migrate.ts';
import { createPool, type Pool } from '../src/db/pool.ts';
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
    expect(rows.map((r) => r.version)).toContain('001_init');
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

  it('enforces the schema constraints', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (username, password_hash, age_confirmed_at) VALUES ('ab', 'scrypt$x', now())`,
      ),
    ).rejects.toThrow(/check/i);
  });
});
