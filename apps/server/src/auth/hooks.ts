import { CSRF_HEADER, CSRF_HEADER_VALUE, SESSION_COOKIE } from '@casino/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { apiError } from '../lib/errors.ts';
import { clearSessionCookie, loadSession, sessionToken, type AuthContext } from './sessions.ts';

/**
 * CSRF (SPEC §6): every non-GET/HEAD request needs `x-casino-csrf: 1` and, when an Origin
 * header is present, it must be one of the configured APP_ORIGIN values.
 */
export function csrfHook(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw apiError('CSRF_REJECTED', 'Richiesta rifiutata: intestazione anti-CSRF mancante.');
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !ctx.config.appOrigins.includes(origin)) {
      throw apiError('CSRF_REJECTED', 'Richiesta rifiutata: origine non consentita.');
    }
  };
}

/** preHandler: resolves the session cookie into request.auth or answers 401. */
export function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = sessionToken(request);
    const auth = token === null ? null : await loadSession(ctx, token);
    if (auth === null) {
      if (request.cookies[SESSION_COOKIE] !== undefined) clearSessionCookie(ctx, reply);
      throw apiError('UNAUTHENTICATED');
    }
    request.auth = auth;
  };
}

export function authOf(request: FastifyRequest): AuthContext {
  if (request.auth === null) throw apiError('UNAUTHENTICATED');
  return request.auth;
}
