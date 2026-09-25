import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './pool.ts';

/** Arbitrary constant key for pg_advisory_lock (serialises concurrent migrators). */
const MIGRATION_LOCK_KEY = 7_240_531_118;
const MIGRATION_FILE = /^(\d{3,})_[A-Za-z0-9_-]+\.sql$/;

/**
 * Locates apps/server/migrations: MIGRATIONS_DIR wins; otherwise it is searched relative to the
 * running file, which is src/db/migrate.ts under tsx/vitest and dist/index.js in the bundle
 * (the build also copies the SQL files to dist/migrations).
 */
export function resolveMigrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.MIGRATIONS_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'migrations'),
    join(here, '..', 'migrations'),
    join(here, '..', '..', 'migrations'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, '001_init.sql')));
  if (!found) {
    throw new Error(`Cartella delle migrazioni non trovata (cercata in ${candidates.join(', ')})`);
  }
  return found;
}

export interface MigrateResult {
  applied: string[];
}

/** Applies pending NNN_name.sql migrations in order, each in its own transaction. */
export async function migrate(
  pool: Pool,
  dir: string = resolveMigrationsDir(),
  log: (msg: string) => void = () => {},
): Promise<MigrateResult> {
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Waiting for another migrator or rewriting a large table may exceed the pool's timeout.
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const { rows } = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations',
      );
      const done = new Set(rows.map((r) => r.version));
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (done.has(version)) continue;
        const sql = readFileSync(join(dir, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migrazione ${file} fallita: ${(err as Error).message}`, { cause: err });
        }
        applied.push(version);
        log(`migrazione applicata: ${version}`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    // The connection goes back to the pool (the server reuses it): restore the timeout.
    let broken: Error | undefined;
    try {
      await client.query('RESET statement_timeout');
    } catch (err) {
      broken = err as Error;
    }
    client.release(broken);
  }
  return { applied };
}
