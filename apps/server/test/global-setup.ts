import { migrate, resolveMigrationsDir } from '../src/db/migrate.ts';
import { createPool } from '../src/db/pool.ts';
import { TEST_DATABASE_URL } from './db-url.ts';

/** Recreates the test schema from scratch and applies every migration once per run. */
export default async function setup(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    // The schema is dropped below: refuse anything that does not look like a test database.
    throw new Error(`TEST_DATABASE_URL deve puntare a un database di test (trovato "${dbName}")`);
  }
  const pool = createPool(TEST_DATABASE_URL, 1);
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await migrate(pool, resolveMigrationsDir());
  } finally {
    await pool.end();
  }
}
