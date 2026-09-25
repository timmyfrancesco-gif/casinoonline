// Starts the already-built production server for the e2e suite (see playwright.config.ts):
// recreates the dedicated E2E database, then runs apps/server/dist/index.js, which applies the
// migrations at startup and serves apps/web/dist from the same origin. Nothing is built here.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// `pg` is a dependency of the server package, not of the workspace root.
const pg = createRequire(new URL('../apps/server/package.json', import.meta.url))('pg');

const port = process.env.E2E_PORT;
if (!port) throw new Error('E2E_PORT non impostata (la imposta playwright.config.ts)');
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/casino_e2e';

for (const file of ['apps/server/dist/index.js', 'apps/web/dist/index.html']) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    console.error(`File mancante: ${file}. Esegui prima "pnpm build".`);
    process.exit(1);
  }
}

// Fresh database on every run. The name must end in _e2e so a real database is never dropped.
const adminUrl = new URL(databaseUrl);
const dbName = decodeURIComponent(adminUrl.pathname.slice(1));
if (!/^[a-z0-9_]+_e2e$/.test(dbName)) {
  console.error(
    `E2E_DATABASE_URL deve puntare a un database dedicato "*_e2e" (trovato "${dbName}").`,
  );
  process.exit(1);
}
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
} finally {
  await admin.end();
}

const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: port,
    HOST: '127.0.0.1',
    APP_ORIGIN: `http://127.0.0.1:${port},http://localhost:${port}`,
    NODE_ENV: 'production',
    COOKIE_SECURE: 'false',
    SERVE_WEB_DIST: 'apps/web/dist',
    // Every test runs from 127.0.0.1: the per-IP limits are covered by the server tests.
    RATE_LIMIT_GLOBAL: '100000',
    RATE_LIMIT_AUTH: '1000',
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
