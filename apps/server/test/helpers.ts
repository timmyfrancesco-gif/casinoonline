import { randomUUID } from 'node:crypto';
import {
  blackjackDeal,
  createRoundRng,
  videoPokerDeal,
  type BlackjackState,
  type Rng,
  type VideoPokerState,
} from '@casino/engine';
import { SESSION_COOKIE, type ApiErrorBody, type MeResponse } from '@casino/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import type { RateLimits } from '../src/context.ts';
import { createPool, type Pool } from '../src/db/pool.ts';
import { TEST_DATABASE_URL } from './db-url.ts';

export { TEST_DATABASE_URL };

export const APP_ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'password-sicura-123';
export const CHIP = 100;

/** Mutable clock injected into the app: tests move time forward. */
export class TestClock {
  offsetMs = 0;
  now = (): Date => new Date(Date.now() + this.offsetMs);
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
      APP_ORIGIN,
      COOKIE_SECURE: 'false',
    }),
    ...overrides,
  };
}

export interface TestEnv {
  app: FastifyInstance;
  pool: Pool;
  clock: TestClock;
  close: () => Promise<void>;
}

export async function createTestEnv(
  options: { rateLimits?: Partial<RateLimits>; config?: Partial<Config> } = {},
): Promise<TestEnv> {
  const pool = createPool(TEST_DATABASE_URL, 20);
  const clock = new TestClock();
  const app = await buildApp({
    config: testConfig(options.config),
    pool,
    now: clock.now,
    // Many users are registered from the same IP in tests: rate limits are tested separately.
    rateLimits: options.rateLimits ?? { global: 100_000, auth: 100_000 },
  });
  await app.ready();
  return {
    app,
    pool,
    clock,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE users, sessions, wallets, seed_pairs, rounds, ledger, loss_limits RESTART IDENTITY CASCADE',
  );
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Client {
  cookie: string | null;
  request: (
    method: Method,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<LightMyRequestResponse>;
  get: (url: string) => Promise<LightMyRequestResponse>;
  post: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  put: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  del: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
}

export function sessionCookieOf(res: LightMyRequestResponse): string | null {
  const c = res.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  return c && c.value !== '' ? `${SESSION_COOKIE}=${c.value}` : null;
}

/** A browser-like client: sends the CSRF header and keeps the session cookie. */
export function client(app: FastifyInstance, cookie: string | null = null): Client {
  const c: Client = {
    cookie,
    request: async (method, url, body, headers = {}) => {
      const res = await app.inject({
        method,
        url,
        headers: {
          ...(method === 'GET' ? {} : { 'x-casino-csrf': '1' }),
          ...(c.cookie ? { cookie: c.cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { payload: body as object }),
      });
      const set = res.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      if (set) c.cookie = set.value === '' ? null : `${SESSION_COOKIE}=${set.value}`;
      return res;
    },
    get: (url) => c.request('GET', url),
    post: (url, body) => c.request('POST', url, body),
    put: (url, body) => c.request('PUT', url, body),
    del: (url, body) => c.request('DELETE', url, body),
  };
  return c;
}

export interface Player extends Client {
  userId: number;
  username: string;
  me: MeResponse;
}

let counter = 0;

export function adultBirthDate(): string {
  return '1990-05-17';
}

export async function registerPlayer(
  app: FastifyInstance,
  username = `giocatore${++counter}`,
): Promise<Player> {
  const c = client(app);
  const res = await c.post('/api/auth/register', {
    username,
    password: PASSWORD,
    birthDate: adultBirthDate(),
    acceptTerms: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  const me = res.json<MeResponse>();
  return Object.assign(c, { userId: Number(me.user.id), username, me });
}

export async function loginPlayer(
  app: FastifyInstance,
  username: string,
  password = PASSWORD,
): Promise<Client> {
  const c = client(app);
  const res = await c.post('/api/auth/login', { username, password });
  expect(res.statusCode, res.body).toBe(200);
  return c;
}

export function expectError(
  res: LightMyRequestResponse,
  status: number,
  code: ApiErrorBody['error']['code'],
): ApiErrorBody['error'] {
  expect(res.statusCode, res.body).toBe(status);
  const body = res.json<ApiErrorBody>();
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  return body.error;
}

export function key(): string {
  return randomUUID();
}

/**
 * Test-only: sets the balance of a user who has only the 'initial' ledger row,
 * rewriting that row so that balance = SUM(ledger) keeps holding.
 */
export async function setInitialBalance(pool: Pool, userId: number, units: number): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM ledger WHERE user_id = $1',
    [userId],
  );
  expect(rows[0]!.n).toBe(1);
  await pool.query(
    `UPDATE ledger SET amount = $2, balance_after = $2 WHERE user_id = $1 AND kind = 'initial'`,
    [userId, units],
  );
  await pool.query('UPDATE wallets SET balance = $2 WHERE user_id = $1', [userId, units]);
}

/**
 * Test-only: picks a client seed for the active pair so that the NEXT round (at the pair's
 * next nonce) satisfies `accept`. Rotates first (via the API) so earlier rounds keep verifying.
 */
export async function prepareNextRound(
  player: Client & { userId: number },
  pool: Pool,
  accept: (rng: Rng) => boolean,
): Promise<void> {
  const rot = await player.post('/api/fairness/rotate', {});
  expect(rot.statusCode, rot.body).toBe(200);
  const { rows } = await pool.query<{ id: number; server_seed: string; next_nonce: number }>(
    'SELECT id, server_seed, next_nonce FROM seed_pairs WHERE user_id = $1 AND active',
    [player.userId],
  );
  const pair = rows[0]!;
  for (let i = 0; i < 200_000; i++) {
    const clientSeed = `test-${i}`;
    const rng = createRoundRng({
      serverSeed: pair.server_seed,
      clientSeed,
      nonce: pair.next_nonce,
    });
    if (accept(rng)) {
      await pool.query('UPDATE seed_pairs SET client_seed = $2 WHERE id = $1', [
        pair.id,
        clientSeed,
      ]);
      return;
    }
  }
  throw new Error('nessun client seed adatto trovato');
}

export function blackjackDealWith(bet: number, accept: (s: BlackjackState) => boolean) {
  return (rng: Rng) => accept(blackjackDeal(bet, rng));
}

export function videoPokerDealWith(bet: number, accept: (s: VideoPokerState) => boolean) {
  return (rng: Rng) => accept(videoPokerDeal(bet, rng));
}

/** SPEC §2 invariants for one user: balance = SUM(ledger), round stake/payout = ledger, chain. */
export async function expectLedgerInvariants(pool: Pool, userId: number): Promise<void> {
  const wallet = await pool.query<{ balance: number }>(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [userId],
  );
  const ledger = await pool.query<{
    id: number;
    round_id: number | null;
    kind: string;
    amount: number;
    balance_after: number;
  }>(
    'SELECT id, round_id, kind, amount, balance_after FROM ledger WHERE user_id = $1 ORDER BY id',
    [userId],
  );
  let running = 0;
  for (const row of ledger.rows) {
    running += row.amount;
    expect(row.balance_after).toBe(running);
    expect(row.balance_after).toBeGreaterThanOrEqual(0);
  }
  expect(wallet.rows[0]!.balance).toBe(running);

  const rounds = await pool.query<{
    id: number;
    stake: number;
    payout: number;
    ledger_stake: number;
    ledger_payout: number;
  }>(
    `SELECT r.id, r.stake, r.payout,
            COALESCE(-SUM(l.amount) FILTER (WHERE l.kind = 'stake'), 0)::bigint AS ledger_stake,
            COALESCE(SUM(l.amount) FILTER (WHERE l.kind = 'payout'), 0)::bigint AS ledger_payout
       FROM rounds r LEFT JOIN ledger l ON l.round_id = r.id
      WHERE r.user_id = $1
      GROUP BY r.id`,
    [userId],
  );
  for (const r of rounds.rows) {
    expect(r.ledger_stake, `stake round ${r.id}`).toBe(r.stake);
    expect(r.ledger_payout, `payout round ${r.id}`).toBe(r.payout);
  }
}
