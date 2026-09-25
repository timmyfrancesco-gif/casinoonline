import { STARTING_BALANCE } from '@casino/engine';
import {
  changePasswordRequestSchema,
  deleteAccountRequestSchema,
  loginRequestSchema,
  MIN_AGE,
  registerRequestSchema,
  type MeResponse,
} from '@casino/shared';
import type { FastifyInstance } from 'fastify';
import { authOf, requireAuth } from '../auth/hooks.ts';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../auth/password.ts';
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  sessionToken,
  setSessionCookie,
} from '../auth/sessions.ts';
import type { AppContext } from '../context.ts';
import type { Queryable } from '../db/pool.ts';
import { withTransaction } from '../db/tx.ts';
import { apiError, parseWith } from '../lib/errors.ts';
import { iso } from '../lib/util.ts';
import { createSeedPair } from '../services/fairness.ts';
import { applyMovement, getBalance, lockUser } from '../services/wallet.ts';

const romeDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** True when the person born on `birthDate` (YYYY-MM-DD) is at least MIN_AGE today (Italian time). */
export function isAdult(birthDate: string, now: Date): boolean {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = romeDate.format(now).split('-').map(Number) as [number, number, number];
  // A 29 February birthday rolls over to 1 March in non-leap years (Date.UTC normalises it).
  const adultFrom = Date.UTC(y + MIN_AGE, m - 1, d);
  return adultFrom <= Date.UTC(ty, tm - 1, td);
}

function isPgUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '23505';
}

async function meResponse(
  db: Queryable,
  user: { id: number; username: string; createdAt: Date },
  sessionStartedAt: Date,
): Promise<MeResponse> {
  return {
    user: { id: String(user.id), username: user.username, createdAt: iso(user.createdAt) },
    balance: await getBalance(db, user.id),
    sessionStartedAt: iso(sessionStartedAt),
  };
}

export function authRoutes(ctx: AppContext) {
  const { pool } = ctx;
  const authRateLimit = { rateLimit: { max: ctx.rateLimits.auth, timeWindow: 60_000 } };

  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/auth/register', { config: authRateLimit }, async (request, reply) => {
      const body = parseWith(registerRequestSchema, request.body);
      const now = ctx.now();
      if (Number(body.birthDate.slice(0, 4)) < 1900) {
        throw apiError('VALIDATION_ERROR', 'Data di nascita non valida.', [
          { path: 'birthDate', message: 'Data di nascita non valida.', code: 'custom' },
        ]);
      }
      if (!isAdult(body.birthDate, now)) throw apiError('UNDERAGE');

      const taken = await pool.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [
        body.username,
      ]);
      if (taken.rowCount) throw apiError('USERNAME_TAKEN');
      const passwordHash = await hashPassword(body.password);

      let created: { userId: number; createdAt: Date; token: string; startedAt: Date };
      try {
        created = await withTransaction(pool, async (client) => {
          // The birth date is only checked, never stored (SPEC §0.6).
          const { rows } = await client.query<{ id: number; created_at: Date }>(
            `INSERT INTO users (username, password_hash, age_confirmed_at, created_at)
             VALUES ($1, $2, $3, $3) RETURNING id, created_at`,
            [body.username, passwordHash, now],
          );
          const user = rows[0]!;
          await client.query(
            'INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, 0, $2)',
            [user.id, now],
          );
          await applyMovement(client, {
            userId: user.id,
            roundId: null,
            kind: 'initial',
            amount: STARTING_BALANCE,
            now,
          });
          await createSeedPair(client, user.id, undefined, now);
          const session = await createSession(client, user.id, now);
          return {
            userId: user.id,
            createdAt: user.created_at,
            token: session.token,
            startedAt: session.startedAt,
          };
        });
      } catch (err) {
        if (isPgUniqueViolation(err)) throw apiError('USERNAME_TAKEN');
        throw err;
      }
      setSessionCookie(ctx, reply, created.token);
      reply.code(201);
      return meResponse(
        pool,
        { id: created.userId, username: body.username, createdAt: created.createdAt },
        created.startedAt,
      );
    });

    app.post('/auth/login', { config: authRateLimit }, async (request, reply) => {
      const body = parseWith(loginRequestSchema, request.body);
      const { rows } = await pool.query<{
        id: number;
        username: string;
        password_hash: string;
        created_at: Date;
      }>(
        'SELECT id, username, password_hash, created_at FROM users WHERE lower(username) = lower($1)',
        [body.username],
      );
      const user = rows[0];
      const ok = user
        ? await verifyPassword(body.password, user.password_hash)
        : await verifyDummyPassword(body.password);
      if (!user || !ok) throw apiError('INVALID_CREDENTIALS');

      const previous = sessionToken(request);
      if (previous !== null) await deleteSessionByToken(pool, previous);
      const session = await createSession(pool, user.id, ctx.now());
      setSessionCookie(ctx, reply, session.token);
      return meResponse(
        pool,
        { id: user.id, username: user.username, createdAt: user.created_at },
        session.startedAt,
      );
    });

    app.post('/auth/logout', async (request, reply) => {
      const token = sessionToken(request);
      if (token !== null) await deleteSessionByToken(pool, token);
      clearSessionCookie(ctx, reply);
      return reply.code(204).send();
    });

    app.get('/auth/me', { preHandler: requireAuth(ctx) }, async (request) => {
      const auth = authOf(request);
      return meResponse(
        pool,
        { id: auth.userId, username: auth.username, createdAt: auth.userCreatedAt },
        auth.sessionStartedAt,
      );
    });

    app.post(
      '/account/password',
      { config: authRateLimit, preHandler: requireAuth(ctx) },
      async (request, reply) => {
        const auth = authOf(request);
        const body = parseWith(changePasswordRequestSchema, request.body);
        const { rows } = await pool.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1',
          [auth.userId],
        );
        const current = rows[0];
        if (!current || !(await verifyPassword(body.currentPassword, current.password_hash))) {
          throw apiError('INVALID_CREDENTIALS', 'La password attuale non è corretta.');
        }
        const newHash = await hashPassword(body.newPassword);
        await withTransaction(pool, async (client) => {
          await lockUser(client, auth.userId);
          await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
            auth.userId,
            newHash,
          ]);
          // Every other session is revoked; the current one stays signed in.
          await client.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [
            auth.userId,
            auth.sessionId,
          ]);
        });
        return reply.code(204).send();
      },
    );

    app.delete(
      '/account',
      { config: authRateLimit, preHandler: requireAuth(ctx) },
      async (request, reply) => {
        const auth = authOf(request);
        const body = parseWith(deleteAccountRequestSchema, request.body);
        const { rows } = await pool.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1',
          [auth.userId],
        );
        const current = rows[0];
        if (!current || !(await verifyPassword(body.password, current.password_hash))) {
          throw apiError('INVALID_CREDENTIALS', 'La password non è corretta.');
        }
        await withTransaction(pool, async (client) => {
          await lockUser(client, auth.userId);
          // ON DELETE CASCADE removes sessions, wallet, seeds, rounds, ledger and limits.
          await client.query('DELETE FROM users WHERE id = $1', [auth.userId]);
        });
        clearSessionCookie(ctx, reply);
        return reply.code(204).send();
      },
    );
  };
}
