import { loadConfig } from '../config.ts';
import { migrate, resolveMigrationsDir } from './migrate.ts';
import { createPool } from './pool.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl, 1);
try {
  const dir = resolveMigrationsDir();
  const { applied } = await migrate(pool, dir, (msg) => console.log(msg));
  console.log(
    applied.length === 0 ? 'Database già aggiornato.' : `Applicate ${applied.length} migrazioni.`,
  );
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
