import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE, SESSION_IDLE_MS, SESSION_TTL_MS } from '@casino/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import type { Queryable } from '../db/pool.ts';
import { sha256 } from '../lib/util.ts';

/** last_seen_at is refreshed at most this often. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthContext {
  userId: number;
  username: string;
  userCreatedAt: Date;
  sessionId: number;
  /** Session start (login time): used by the reality check and session stats. */
  sessionStartedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export async function createSession(
  db: Queryable,
  userId: number,
  now: Date,
): Promise<{ token: string; sessionId: number; startedAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  // Opportunistic cleanup of this user's dead sessions.
  await db.query(
    `DELETE FROM sessions WHERE user_id = $1 AND (expires_at <= $2 OR last_seen_at <= $3)`,
    [userId, now, new Date(now.getTime() - SESSION_IDLE_MS)],
  );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $3, $4) RETURNING id`,
    [userId, sha256(token), now, expiresAt],
  );
  return { token, sessionId: rows[0]!.id, startedAt: now };
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: ctx.config.cookieSecure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: ctx.config.cookieSecure,
  });
}

export function sessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  return typeof raw === 'string' && TOKEN_PATTERN.test(raw) ? raw : null;
}

interface SessionRow {
  session_id: number;
  user_id: number;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  username: string;
  user_created_at: Date;
}

/** Resolves the session cookie; expired or idle sessions are deleted and yield null. */
export async function loadSession(ctx: AppContext, token: string): Promise<AuthContext | null> {
  const now = ctx.now();
  const { rows } = await ctx.pool.query<SessionRow>(
    `SELECT s.id AS session_id, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
            u.username, u.created_at AS user_created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  const nowMs = now.getTime();
  if (row.expires_at.getTime() <= nowMs || row.last_seen_at.getTime() + SESSION_IDLE_MS <= nowMs) {
    await ctx.pool.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
    return null;
  }
  if (nowMs - row.last_seen_at.getTime() >= TOUCH_INTERVAL_MS) {
    await ctx.pool.query(
      'UPDATE sessions SET last_seen_at = $2 WHERE id = $1 AND last_seen_at < $2',
      [row.session_id, now],
    );
  }
  return {
    userId: row.user_id,
    username: row.username,
    userCreatedAt: row.user_created_at,
    sessionId: row.session_id,
    sessionStartedAt: row.created_at,
  };
}

export async function deleteSessionByToken(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}
