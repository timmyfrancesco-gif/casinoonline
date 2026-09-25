import type { ApiErrorBody, ErrorCode } from '@casino/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  UNDERAGE: 400,
  INSUFFICIENT_FUNDS: 400,
  BET_LIMIT: 400,
  RG_SELF_EXCLUDED: 403,
  RG_LOSS_LIMIT: 403,
  ROUND_ALREADY_OPEN: 409,
  ROUND_NOT_OPEN: 409,
  ILLEGAL_ACTION: 400,
  SEED_ROTATION_BLOCKED: 409,
  RESET_NOT_ALLOWED: 409,
  INTERNAL: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Dati non validi.',
  UNAUTHENTICATED: 'Devi accedere per continuare.',
  CSRF_REJECTED: 'Richiesta rifiutata dalla protezione CSRF.',
  NOT_FOUND: 'Risorsa non trovata.',
  CONFLICT: 'La richiesta è in conflitto con lo stato attuale: aggiorna e riprova.',
  RATE_LIMITED: 'Troppe richieste: riprova tra poco.',
  USERNAME_TAKEN: 'Nome utente già in uso.',
  INVALID_CREDENTIALS: 'Nome utente o password non corretti.',
  UNDERAGE: 'Devi avere almeno 18 anni per registrarti.',
  INSUFFICIENT_FUNDS: 'Saldo insufficiente per questa puntata.',
  BET_LIMIT: 'Puntata fuori dai limiti del tavolo.',
  RG_SELF_EXCLUDED: 'Pausa attiva: non puoi puntare fino al termine della pausa.',
  RG_LOSS_LIMIT: 'La puntata supererebbe il tuo limite di perdita.',
  ROUND_ALREADY_OPEN: 'Hai già una mano in corso a questo tavolo.',
  ROUND_NOT_OPEN: 'Questa mano non è in corso.',
  ILLEGAL_ACTION: 'Azione non consentita in questo momento.',
  SEED_ROTATION_BLOCKED: 'Completa la mano in corso prima di cambiare la coppia di seed.',
  RESET_NOT_ALLOWED:
    'Puoi ricominciare solo con un saldo inferiore a quello iniziale e senza mani in corso.',
  INTERNAL: 'Errore interno del server.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** ApiError with the standard status and (optionally) the default Italian message. */
export function apiError(code: ErrorCode, message?: string, details?: unknown): ApiError {
  return new ApiError(code, ERROR_STATUS[code], message ?? DEFAULT_MESSAGES[code], details);
}

export function zodIssues(error: z.ZodError): { path: string; message: string; code: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/** Validates with a zod schema; failures become 400 VALIDATION_ERROR with the issues as details. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw apiError('VALIDATION_ERROR', undefined, zodIssues(result.error));
  }
  return result.data;
}

function isZodError(error: unknown): error is z.ZodError {
  return (
    error instanceof Error &&
    error.name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

interface PgLikeError {
  code?: unknown;
  severity?: unknown;
}

function pgCode(error: unknown): string | null {
  const e = error as PgLikeError;
  return typeof e?.code === 'string' && typeof e.severity === 'string' ? e.code : null;
}

/** Converts any thrown value into an ApiError; unknown errors become INTERNAL. */
export function toApiError(error: unknown): { apiErr: ApiError; unexpected: boolean } {
  if (error instanceof ApiError) return { apiErr: error, unexpected: false };
  if (isZodError(error)) {
    return { apiErr: apiError('VALIDATION_ERROR', undefined, zodIssues(error)), unexpected: false };
  }
  const code = pgCode(error);
  if (code === '23505' || code === '40P01' || code === '40001' || code === '55P03') {
    // Unique violation / deadlock / serialization failure: a concurrent request won the race.
    return { apiErr: apiError('CONFLICT'), unexpected: false };
  }
  const statusCode = (error as FastifyError | undefined)?.statusCode;
  if (code === null && typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    if (statusCode === 404) return { apiErr: apiError('NOT_FOUND'), unexpected: false };
    if (statusCode === 429) return { apiErr: apiError('RATE_LIMITED'), unexpected: false };
    if (statusCode === 413) {
      return {
        apiErr: new ApiError('VALIDATION_ERROR', 413, 'Richiesta troppo grande.'),
        unexpected: false,
      };
    }
    if (statusCode === 415) {
      return {
        apiErr: new ApiError('VALIDATION_ERROR', 415, 'Formato della richiesta non supportato.'),
        unexpected: false,
      };
    }
    return {
      apiErr: new ApiError('VALIDATION_ERROR', 400, 'Richiesta non valida.'),
      unexpected: false,
    };
  }
  return { apiErr: apiError('INTERNAL'), unexpected: true };
}

/** Single Fastify error handler: always answers with ApiErrorBody, never leaks internals. */
export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const { apiErr, unexpected } = toApiError(error);
  if (unexpected) {
    request.log.error({ err: error }, 'errore non gestito');
  } else if (apiErr.status >= 500) {
    request.log.error({ err: error }, apiErr.message);
  } else {
    const sqlState = pgCode(error);
    if (sqlState === '40P01' || sqlState === '40001') {
      // The user lock at READ COMMITTED should make these impossible: a deadlock or a
      // misconfigured isolation level must not go unnoticed behind a plain 409.
      request.log.warn({ err: error, sqlState }, 'conflitto di concorrenza nel database');
    }
  }
  void reply.status(apiErr.status).type('application/json; charset=utf-8').send(apiErr.toBody());
}
