import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate, resolveMigrationsDir } from './db/migrate.ts';
import { createPool } from './db/pool.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  await migrate(pool, resolveMigrationsDir(), (msg) => console.log(msg));
} catch (err) {
  console.error((err as Error).message);
  await pool.end();
  process.exit(1);
}

const app = await buildApp({ config, pool });

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'arresto in corso');
  const timer = setTimeout(() => {
    app.log.error('arresto forzato dopo il timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'errore durante l’arresto');
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error({ err }, 'avvio non riuscito');
  await pool.end();
  process.exit(1);
}
