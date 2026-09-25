import { STARTING_BALANCE } from '@casino/engine';
import { SESSION_IDLE_MS, SESSION_TTL_MS, type MeResponse } from '@casino/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { isAdult } from '../src/routes/auth.ts';
import {
  client,
  createTestEnv,
  expectError,
  key,
  loginPlayer,
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
  env.clock.offsetMs = 0;
});

function isoDateYearsAgo(years: number, dayOffset = 0): string {
  const romeToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = romeToday.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d + dayOffset));
  return date.toISOString().slice(0, 10);
}

describe('registration', () => {
  it('creates the account, wallet, first seed pair and a session cookie', async () => {
    const c = client(env.app);
    const res = await c.post('/api/auth/register', {
      username: 'Mario_Rossi',
      password: PASSWORD,
      birthDate: '1990-01-01',
      acceptTerms: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const me = res.json<MeResponse>();
    expect(me.user.username).toBe('Mario_Rossi');
    expect(me.user.id).toMatch(/^\d+$/);
    expect(me.balance).toBe(STARTING_BALANCE);
    expect(Date.parse(me.sessionStartedAt)).not.toBeNaN();

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/casino_sid=[A-Za-z0-9_-]{43}/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);

    const userId = Number(me.user.id);
    const ledger = await env.pool.query('SELECT kind, amount FROM ledger WHERE user_id = $1', [
      userId,
    ]);
    expect(ledger.rows).toEqual([{ kind: 'initial', amount: STARTING_BALANCE }]);
    const seeds = await env.pool.query(
      'SELECT server_seed, client_seed, active FROM seed_pairs WHERE user_id = $1',
      [userId],
    );
    expect(seeds.rows).toHaveLength(1);
    expect(seeds.rows[0].server_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(seeds.rows[0].client_seed).toMatch(/^[0-9a-f]{32}$/);
    // Only the hash of the token is stored; the birth date is never stored.
    const sessions = await env.pool.query('SELECT token_hash FROM sessions WHERE user_id = $1', [
      userId,
    ]);
    expect(sessions.rows[0].token_hash).toHaveLength(32);
    const columns = await env.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    expect(columns.rows.map((r) => r.column_name)).not.toContain('birth_date');
    const hash = await env.pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    expect(hash.rows[0].password_hash).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);

    const meRes = await c.get('/api/auth/me');
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json<MeResponse>().user.id).toBe(me.user.id);
  });

  it('rejects minors, accepts exactly 18 today', async () => {
    const minor = await client(env.app).post('/api/auth/register', {
      username: 'minorenne',
      password: PASSWORD,
      birthDate: isoDateYearsAgo(18, 1),
      acceptTerms: true,
    });
    expectError(minor, 400, 'UNDERAGE');
    const count = await env.pool.query('SELECT COUNT(*) AS n FROM users');
    expect(count.rows[0].n).toBe(0);

    const adult = await client(env.app).post('/api/auth/register', {
      username: 'diciottenne',
      password: PASSWORD,
      birthDate: isoDateYearsAgo(18),
      acceptTerms: true,
    });
    expect(adult.statusCode, adult.body).toBe(201);
  });

  it('computes the age with 29 February birthdays', () => {
    expect(isAdult('2008-02-29', new Date('2026-02-28T12:00:00Z'))).toBe(false);
    expect(isAdult('2008-02-29', new Date('2026-03-01T12:00:00Z'))).toBe(true);
    expect(isAdult('2030-01-01', new Date('2026-03-01T12:00:00Z'))).toBe(false);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    await registerPlayer(env.app, 'Giulia');
    const res = await client(env.app).post('/api/auth/register', {
      username: 'gIULIA',
      password: PASSWORD,
      birthDate: '1980-02-02',
      acceptTerms: true,
    });
    expectError(res, 409, 'USERNAME_TAKEN');
  });

  it('validates the body with the shared schema', async () => {
    const res = await client(env.app).post('/api/auth/register', {
      username: 'x',
      password: 'corta',
      birthDate: '1990-13-45',
      acceptTerms: false,
    });
    const err = expectError(res, 400, 'VALIDATION_ERROR');
    const paths = (err.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['acceptTerms', 'birthDate', 'password', 'username']);
  });
});

describe('login and sessions', () => {
  it('logs in case-insensitively and rejects wrong credentials generically', async () => {
    await registerPlayer(env.app, 'Luca');
    const ok = await client(env.app).post('/api/auth/login', {
      username: 'luca',
      password: PASSWORD,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<MeResponse>().user.username).toBe('Luca');

    const wrong = await client(env.app).post('/api/auth/login', {
      username: 'Luca',
      password: 'password-sbagliata',
    });
    const missing = await client(env.app).post('/api/auth/login', {
      username: 'nessuno',
      password: PASSWORD,
    });
    const e1 = expectError(wrong, 401, 'INVALID_CREDENTIALS');
    const e2 = expectError(missing, 401, 'INVALID_CREDENTIALS');
    expect(e1.message).toBe(e2.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('logout revokes the session and clears the cookie', async () => {
    const p = await registerPlayer(env.app);
    const cookie = p.cookie!;
    const res = await p.post('/api/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/casino_sid=;/);
    const stale = client(env.app, cookie);
    expectError(await stale.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    expectError(await client(env.app).get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    expectError(
      await client(env.app, 'casino_sid=garbage').get('/api/wallet'),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('expires idle sessions after 12 hours', async () => {
    const p = await registerPlayer(env.app);
    env.clock.advance(SESSION_IDLE_MS - 60_000);
    expect((await p.get('/api/auth/me')).statusCode).toBe(200);
    // Activity refreshed last_seen_at: another almost-12h is fine.
    env.clock.advance(SESSION_IDLE_MS - 60_000);
    expect((await p.get('/api/auth/me')).statusCode).toBe(200);
    env.clock.advance(SESSION_IDLE_MS + 1000);
    expectError(await p.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    const left = await env.pool.query('SELECT COUNT(*) AS n FROM sessions WHERE user_id = $1', [
      p.userId,
    ]);
    expect(left.rows[0].n).toBe(0);
  });

  it('expires sessions 7 days after login even when active', async () => {
    const p = await registerPlayer(env.app);
    const step = 6 * 60 * 60 * 1000;
    let elapsed = 0;
    while (elapsed + step < SESSION_TTL_MS) {
      env.clock.advance(step);
      elapsed += step;
      expect((await p.get('/api/wallet')).statusCode).toBe(200);
    }
    env.clock.advance(SESSION_TTL_MS - elapsed + 1000);
    expectError(await p.get('/api/wallet'), 401, 'UNAUTHENTICATED');
  });

  it('change password keeps the current session under a new token and revokes the others', async () => {
    const a = await registerPlayer(env.app, 'Anna');
    const b = await loginPlayer(env.app, 'Anna');
    const wrong = await a.post('/api/account/password', {
      currentPassword: 'non-e-questa-1',
      newPassword: 'nuova-password-456',
    });
    expectError(wrong, 401, 'INVALID_CREDENTIALS');

    const oldCookie = a.cookie;
    env.clock.advance(5 * 60_000);
    const res = await a.post('/api/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'nuova-password-456',
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(a.cookie).not.toBeNull();
    expect(a.cookie).not.toBe(oldCookie);
    const me = await a.get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    // Same session (its start is kept for the reality check and the session stats).
    expect(me.json<MeResponse>().sessionStartedAt).toBe(a.me.sessionStartedAt);
    // A copy of the old cookie (e.g. a stolen one) no longer works.
    expectError(await client(env.app, oldCookie).get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    expectError(await b.get('/api/auth/me'), 401, 'UNAUTHENTICATED');

    expectError(
      await client(env.app).post('/api/auth/login', { username: 'Anna', password: PASSWORD }),
      401,
      'INVALID_CREDENTIALS',
    );
    await loginPlayer(env.app, 'Anna', 'nuova-password-456');
  });

  it('login racing the account deletion answers 401, not 500', async () => {
    const p = await registerPlayer(env.app, 'Fantasma');
    // The account is deleted between the password check and the session insert.
    let deleted = false;
    const racingPool = new Proxy(env.pool, {
      get(target, prop) {
        if (prop === 'query') {
          return async (text: string, params?: unknown[]) => {
            if (!deleted && text.startsWith('INSERT INTO sessions')) {
              deleted = true;
              await target.query('DELETE FROM users WHERE id = $1', [p.userId]);
            }
            return target.query(text, params);
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const app = await buildApp({
      config: testConfig(),
      pool: racingPool,
      rateLimits: { global: 100_000, auth: 100_000 },
    });
    try {
      const res = await client(app).post('/api/auth/login', {
        username: 'Fantasma',
        password: PASSWORD,
      });
      expect(deleted).toBe(true);
      expectError(res, 401, 'INVALID_CREDENTIALS');
    } finally {
      await app.close();
    }
  });

  it('delete account removes every row of the user', async () => {
    const p = await registerPlayer(env.app, 'Cancellami');
    const other = await registerPlayer(env.app, 'Resto');
    expect(
      (await p.post('/api/games/slot/spin', { amount: 100, idempotencyKey: key() })).statusCode,
    ).toBe(200);
    expect(
      (await p.post('/api/games/blackjack/deal', { amount: 100, idempotencyKey: key() }))
        .statusCode,
    ).toBe(200);
    await p.put('/api/rg/loss-limit', { period: '7d', value: 10_000 });
    await p.post('/api/fairness/rotate', {});

    expectError(
      await p.del('/api/account', { password: 'sbagliata-123' }),
      401,
      'INVALID_CREDENTIALS',
    );
    const res = await p.del('/api/account', { password: PASSWORD });
    expect(res.statusCode, res.body).toBe(204);

    for (const table of [
      'users',
      'sessions',
      'wallets',
      'seed_pairs',
      'next_server_seeds',
      'rounds',
      'ledger',
      'loss_limits',
    ]) {
      const column = table === 'users' ? 'id' : 'user_id';
      const { rows } = await env.pool.query(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = $1`,
        [p.userId],
      );
      expect(rows[0].n, table).toBe(0);
    }
    expectError(await p.get('/api/auth/me'), 401, 'UNAUTHENTICATED');
    expect((await other.get('/api/wallet')).statusCode).toBe(200);
    // The username is free again.
    await registerPlayer(env.app, 'cancellami');
  });
});

describe('secure session cookie', () => {
  it('uses the __Host- prefix with Secure, Path=/ and no Domain when cookies are secure', async () => {
    const secure = await createTestEnv({ config: { cookieSecure: true } });
    try {
      const res = await secure.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'x-casino-csrf': '1' },
        payload: {
          username: 'sicuro',
          password: PASSWORD,
          birthDate: '1990-05-17',
          acceptTerms: true,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const cookie = res.cookies.find((c) => c.name === '__Host-casino_sid');
      expect(cookie).toMatchObject({ secure: true, httpOnly: true, path: '/', sameSite: 'Lax' });
      expect(cookie?.domain).toBeUndefined();
      expect(res.cookies.some((c) => c.name === 'casino_sid')).toBe(false);

      const me = await secure.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { '__Host-casino_sid': cookie!.value },
      });
      expect(me.statusCode, me.body).toBe(200);
      // The unprefixed name is not accepted when cookies are secure.
      const plain = await secure.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { casino_sid: cookie!.value },
      });
      expect(plain.statusCode).toBe(401);
    } finally {
      await secure.close();
    }
  });
});
