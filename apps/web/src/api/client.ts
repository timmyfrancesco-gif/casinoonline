import { CSRF_HEADER, CSRF_HEADER_VALUE, type ApiErrorBody, type ErrorCode } from '@casino/shared';

/** Base path of the HTTP API (same origin; Vite proxies it in development). */
export const API_BASE = '/api';

/** Client-side failures that never reach the server contract. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly details: unknown;

  constructor(
    status: number,
    code: ErrorCode | ClientErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

function fallbackCode(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'CSRF_REJECTED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'VALIDATION_ERROR';
  return 'INTERNAL';
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Typed fetch wrapper: same-origin cookies, JSON bodies, CSRF header on every
 * state-changing request, errors normalised to ApiError (see ApiErrorBody).
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  const init: RequestInit = { method, headers, credentials: 'include' };
  // Only send a JSON content type with an actual body: an empty JSON body is a 400 on the server.
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Connessione non riuscita. Controlla la rete e riprova.',
    );
  }

  if (res.status === 204) return undefined as T;
  const payload = await readJson(res);

  if (!res.ok) {
    if (isApiErrorBody(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(res.status, code, message, details);
    }
    throw new ApiError(res.status, fallbackCode(res.status), `Errore ${res.status}`);
  }
  if (payload === undefined) {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'Risposta del server non valida.');
  }
  return payload as T;
}

/** Builds a query string, skipping undefined/empty values. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}
