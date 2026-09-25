import { describe, expect, it } from 'vitest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@casino/shared';
import { errorResponse, jsonResponse, mockFetch } from '../test/utils.tsx';
import { getMe, logout } from './auth.ts';
import { ApiError, apiFetch, queryString } from './client.ts';
import { errorMessage } from './errors.ts';
import { getHistory } from './history.ts';
import { newIdempotencyKey } from './idempotency.ts';

describe('apiFetch', () => {
  it('sends the CSRF header, JSON body and cookies on non-GET requests', async () => {
    const { calls, fn } = mockFetch(() => jsonResponse({ balance: 500 }));
    const res = await apiFetch<{ balance: number }>('/wallet/reset', {
      method: 'POST',
      body: { a: 1 },
    });
    expect(res).toEqual({ balance: 500 });
    expect(calls[0]).toMatchObject({
      url: '/api/wallet/reset',
      method: 'POST',
      body: { a: 1 },
    });
    expect(calls[0]!.headers[CSRF_HEADER]).toBe(CSRF_HEADER_VALUE);
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(fn.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('does not send the CSRF header or a body on GET', async () => {
    const { calls, fn } = mockFetch(() => jsonResponse({ ok: true }));
    await apiFetch('/health');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers[CSRF_HEADER]).toBeUndefined();
    expect(calls[0]!.headers['content-type']).toBeUndefined();
    expect(fn.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('omits the JSON content type when there is no body (empty JSON bodies are rejected)', async () => {
    const { calls } = mockFetch(() => new Response(null, { status: 204 }));
    await expect(logout()).resolves.toBeUndefined();
    expect(calls[0]!.headers[CSRF_HEADER]).toBe(CSRF_HEADER_VALUE);
    expect(calls[0]!.headers['content-type']).toBeUndefined();
  });

  it('parses ApiErrorBody into ApiError with code, message and details', async () => {
    mockFetch(() =>
      errorResponse(403, 'RG_LOSS_LIMIT', 'Limite superato', { period: '24h', remaining: 1500 }),
    );
    const err = await apiFetch('/games/slot/spin', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.code).toBe('RG_LOSS_LIMIT');
    expect(apiErr.message).toBe('Limite superato');
    expect(apiErr.details).toEqual({ period: '24h', remaining: 1500 });
  });

  it('falls back to a status-based code for non-JSON errors', async () => {
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/stats')).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(apiFetch('/stats')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('getMe returns null on 401 instead of throwing', async () => {
    mockFetch(() => errorResponse(401, 'UNAUTHENTICATED'));
    await expect(getMe()).resolves.toBeNull();
  });

  it('builds history query strings without empty values', async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [], nextCursor: null }));
    await getHistory({ game: 'slot', cursor: undefined, limit: 25 });
    expect(calls[0]!.url).toBe('/api/history?game=slot&limit=25');
    expect(queryString({ a: undefined, b: '' })).toBe('');
  });
});

describe('errorMessage', () => {
  it('explains loss limits with the remaining amount in chips', () => {
    const msg = errorMessage(
      new ApiError(403, 'RG_LOSS_LIMIT', 'x', { period: '7d', remaining: 2550 }),
    );
    expect(msg).toContain('dei 7 giorni');
    expect(msg).toContain('25,50 fiches');
  });

  it('includes the self-exclusion end date', () => {
    const msg = errorMessage(
      new ApiError(403, 'RG_SELF_EXCLUDED', 'x', { until: '2026-10-01T12:00:00.000Z' }),
    );
    expect(msg).toMatch(/autoesclusione fino al .*2026/);
  });

  it('has friendly Italian text for common codes', () => {
    expect(errorMessage(new ApiError(400, 'INSUFFICIENT_FUNDS', 'x'))).toBe(
      'Saldo insufficiente per questa puntata.',
    );
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', 'x'))).toMatch(/Troppe richieste/);
    expect(errorMessage(new ApiError(400, 'UNDERAGE', 'x'))).toMatch(/18 anni/);
    expect(errorMessage(new ApiError(409, 'USERNAME_TAKEN', 'x'))).toMatch(/già in uso/);
  });
});

describe('newIdempotencyKey', () => {
  it('returns distinct RFC 4122 v4 UUIDs', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
