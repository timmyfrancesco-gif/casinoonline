import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests on the full system: the production build of the server (apps/server/dist)
 * serving the web build (apps/web/dist) against a fresh `casino_e2e` database.
 * Build first: `pnpm build && pnpm test:e2e`.
 */

/** A free TCP port, picked synchronously (the config is evaluated before any await). */
function freePort(): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});",
    ],
    { encoding: 'utf8' },
  ).trim();
}

// Workers re-evaluate this file: the port chosen by the runner is shared through the env.
const port = process.env.E2E_PORT ?? (process.env.E2E_PORT = freePort());
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `${baseURL}/api/health`,
    env: { E2E_PORT: port },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
