import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db/pool.ts';
import {
  APP_ORIGIN,
  client,
  createTestEnv,
  expectError,
  key,
  PASSWORD,
  registerPlayer,
  testConfig,
  truncateAll,
  type TestEnv,
} from './helpers.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await truncateAll(env.pool);
});

describe('CSRF', () => {
  it('requires the x-casino-csrf header on state-changing requests', async () => {
    const p = await registerPlayer(env.app);
    const body = { amount: 100, idempotencyKey: key() };
    expectError(
      await p.request('POST', '/api/games/slot/spin', body, { 'x-casino-csrf': '' }),
      403,
      'CSRF_REJECTED',
    );
    expectError(
      await p.request('POST', '/api/games/slot/spin', body, { 'x-casino-csrf': '0' }),
      403,
      'CSRF_REJECTED',
    );
    const noHeader = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: p.username, password: PASSWORD },
    });
    expectError(noHeader, 403, 'CSRF_REJECTED');
    const rounds = await env.pool.query('SELECT COUNT(*) AS n FROM rounds');
    expect(rounds.rows[0].n).toBe(0);
    expect((await p.post('/api/games/slot/spin', body)).statusCode).toBe(200);
  });

  it('rejects a foreign Origin and accepts APP_ORIGIN', async () => {
    const p = await registerPlayer(env.app);
    expectError(
      await p.request('POST', '/api/wallet/reset', undefined, { origin: 'https://evil.example' }),
      403,
      'CSRF_REJECTED',
    );
    expectError(
      await p.request('POST', '/api/wallet/reset', undefined, { origin: 'null' }),
      403,
      'CSRF_REJECTED',
    );
    // Same origin passes the CSRF check (and then fails on business rules).
    expectError(
      await p.request('POST', '/api/wallet/reset', undefined, { origin: APP_ORIGIN }),
      409,
      'RESET_NOT_ALLOWED',
    );
  });

  it('does not require the header on GET', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });
});

describe('errors', () => {
  it('answers ApiErrorBody for unknown API routes', async () => {
    expectError(await client(env.app).get('/api/nope'), 404, 'NOT_FOUND');
    expectError(await client(env.app).post('/api/nope', {}), 404, 'NOT_FOUND');
    expectError(await client(env.app).get('/altro'), 404, 'NOT_FOUND');
  });

  it('maps malformed JSON and unsupported content to VALIDATION_ERROR', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-casino-csrf': '1', 'content-type': 'application/json' },
      payload: '{"username": ',
    });
    expectError(res, 400, 'VALIDATION_ERROR');
    const text = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-casino-csrf': '1', 'content-type': 'text/plain' },
      payload: 'ciao',
    });
    expectError(text, 400, 'VALIDATION_ERROR');
    const poisoned = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-casino-csrf': '1', 'content-type': 'application/json' },
      payload: '{"username":"a","password":"b","__proto__":{"x":1}}',
    });
    expectError(poisoned, 400, 'VALIDATION_ERROR');
  });

  it('accepts empty JSON bodies on body-less endpoints', async () => {
    const p = await registerPlayer(env.app);
    const res = await p.request('POST', '/api/auth/logout', undefined, {
      'content-type': 'application/json',
    });
    expect(res.statusCode).toBe(204);
  });

  it('rejects bodies over 64 KiB', async () => {
    const res = await client(env.app).post('/api/auth/login', {
      username: 'a',
      password: 'x'.repeat(70 * 1024),
    });
    expectError(res, 413, 'VALIDATION_ERROR');
  });

  it('never leaks internal errors', async () => {
    const pool = createPool('postgres://postgres:postgres@localhost:5432/casino_test', 1);
    const app = await buildApp({ config: testConfig(), pool });
    app.get('/api/boom', async () => {
      throw new Error('dettaglio segreto del database');
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expectError(res, 500, 'INTERNAL');
    expect(res.body).not.toContain('segreto');
    expect(res.body).not.toContain('stack');
    await app.close();
    await pool.end();
  });

  it('validates query strings', async () => {
    const p = await registerPlayer(env.app);
    expectError(await p.get('/api/history?limit=1000'), 400, 'VALIDATION_ERROR');
    expectError(await p.get('/api/history?game=poker'), 400, 'VALIDATION_ERROR');
    expectError(await p.get('/api/history?cursor=abc'), 400, 'VALIDATION_ERROR');
  });

  it('requires authentication on player endpoints', async () => {
    const anon = client(env.app);
    for (const url of ['/api/wallet', '/api/fairness', '/api/rg', '/api/stats', '/api/history']) {
      expectError(await anon.get(url), 401, 'UNAUTHENTICATED');
    }
    expectError(
      await anon.post('/api/games/slot/spin', { amount: 100, idempotencyKey: key() }),
      401,
      'UNAUTHENTICATED',
    );
  });
});

describe('security headers', () => {
  it('sends a strict CSP and the helmet headers', async () => {
    const res = await client(env.app).get('/api/health');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('rate limiting', () => {
  it('limits login attempts to 10 per minute per IP', async () => {
    const limited = await createTestEnv({ rateLimits: { global: 300, auth: 10 } });
    try {
      const c = client(limited.app);
      for (let i = 0; i < 10; i++) {
        const res = await c.post('/api/auth/login', { username: 'nessuno', password: 'x' });
        expectError(res, 401, 'INVALID_CREDENTIALS');
      }
      const blocked = await c.post('/api/auth/login', { username: 'nessuno', password: 'x' });
      const err = expectError(blocked, 429, 'RATE_LIMITED');
      expect(err.details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
      expect(blocked.headers['retry-after']).toBeDefined();
      // Another IP is not affected.
      const other = await limited.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.0.0.2',
        headers: { 'x-casino-csrf': '1' },
        payload: { username: 'nessuno', password: 'x' },
      });
      expectError(other, 401, 'INVALID_CREDENTIALS');
      // The global limit on other routes is separate.
      expect((await c.get('/api/health')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('applies the global limit', async () => {
    const limited = await createTestEnv({ rateLimits: { global: 5, auth: 10 } });
    try {
      const c = client(limited.app);
      for (let i = 0; i < 5; i++) expect((await c.get('/api/health')).statusCode).toBe(200);
      expectError(await c.get('/api/health'), 429, 'RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});

describe('SPA serving', () => {
  it('serves the web build with index.html fallback outside /api', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'casino-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Casinò</title>');
    writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');
    const spa = await createTestEnv({ config: { serveWebDist: dir } });
    try {
      const c = client(spa.app);
      const home = await c.get('/');
      expect(home.statusCode).toBe(200);
      expect(home.headers['content-type']).toMatch(/text\/html/);
      expect(home.body).toContain('Casinò');
      const deep = await c.get('/storico/42');
      expect(deep.statusCode).toBe(200);
      expect(deep.body).toContain('Casinò');
      expect(deep.headers['cache-control']).toBe('no-cache');
      const asset = await c.get('/assets/app-123.js');
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      expectError(await c.get('/assets/missing.js'), 404, 'NOT_FOUND');
      expectError(await c.get('/api/missing'), 404, 'NOT_FOUND');
      expect((await c.get('/api/health')).json()).toEqual({ ok: true, db: true });
    } finally {
      await spa.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('config', () => {
  it('parses and validates the environment', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x/y' });
    expect(c).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      appOrigins: ['http://localhost:5173'],
      nodeEnv: 'development',
      cookieSecure: false,
      serveWebDist: null,
      trustProxy: false,
      rateLimits: {},
    });
    expect(
      loadConfig({ DATABASE_URL: 'x', RATE_LIMIT_GLOBAL: '5000', RATE_LIMIT_AUTH: '200' })
        .rateLimits,
    ).toEqual({ global: 5000, auth: 200 });
    expect(() => loadConfig({ DATABASE_URL: 'x', RATE_LIMIT_AUTH: '0' })).toThrow(
      /RATE_LIMIT_AUTH/,
    );
    const prod = loadConfig({
      DATABASE_URL: 'postgres://x/y',
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      APP_ORIGIN: 'https://casino.example/, https://www.casino.example',
      SERVE_WEB_DIST: '../web/dist',
    });
    expect(prod.cookieSecure).toBe(true);
    expect(prod.trustProxy).toBe(1);
    expect(prod.appOrigins).toEqual(['https://casino.example', 'https://www.casino.example']);
    expect(prod.serveWebDist).toBe('../web/dist');
    expect(
      loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production', COOKIE_SECURE: 'false' })
        .cookieSecure,
    ).toBe(false);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'x', APP_ORIGIN: 'ftp://a' })).toThrow(/APP_ORIGIN/);
  });
});
