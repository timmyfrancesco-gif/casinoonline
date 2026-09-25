import type { ErrorCode } from '@casino/shared';
import { chipsLabel, formatDateTimeLong } from '../lib/format.ts';
import { ApiError, type ClientErrorCode } from './client.ts';

const PERIOD_LABELS: Record<string, string> = {
  '24h': 'delle 24 ore',
  '7d': 'dei 7 giorni',
  '30d': 'dei 30 giorni',
};

const MESSAGES: Record<ErrorCode | ClientErrorCode, string> = {
  VALIDATION_ERROR: 'Alcuni dati non sono validi: controlla i campi e riprova.',
  UNAUTHENTICATED: 'La sessione è scaduta: accedi di nuovo.',
  CSRF_REJECTED: 'Richiesta rifiutata per motivi di sicurezza. Ricarica la pagina e riprova.',
  NOT_FOUND: 'Elemento non trovato.',
  CONFLICT: 'La partita è cambiata nel frattempo: lo stato è stato aggiornato.',
  RATE_LIMITED: 'Troppe richieste in poco tempo: attendi qualche istante e riprova.',
  USERNAME_TAKEN: 'Questo nome utente è già in uso: scegline un altro.',
  INVALID_CREDENTIALS: 'Nome utente o password non corretti.',
  UNDERAGE: 'Per registrarti devi avere almeno 18 anni.',
  INSUFFICIENT_FUNDS: 'Saldo insufficiente per questa puntata.',
  BET_LIMIT: 'Puntata fuori dai limiti del tavolo.',
  RG_SELF_EXCLUDED: 'È attiva una pausa di autoesclusione: non puoi puntare.',
  RG_LOSS_LIMIT: 'Questa puntata supererebbe il tuo limite di perdita.',
  ROUND_ALREADY_OPEN:
    'Hai già una mano aperta in questo gioco: completala prima di iniziarne un’altra.',
  ROUND_NOT_OPEN: 'Questa mano è già chiusa.',
  ILLEGAL_ACTION: 'Mossa non consentita in questo momento.',
  SEED_ROTATION_BLOCKED:
    'Non puoi cambiare i seed mentre hai una mano aperta (blackjack o video poker): completala prima.',
  RESET_NOT_ALLOWED:
    'Puoi ricominciare solo con un saldo inferiore a quello iniziale e senza mani aperte.',
  INTERNAL: 'Si è verificato un errore del server. Riprova tra poco.',
  NETWORK_ERROR: 'Connessione non riuscita. Controlla la rete e riprova.',
  BAD_RESPONSE: 'Risposta del server non valida. Riprova tra poco.',
};

/** Generic text for unexpected failures: raw technical messages are never shown. */
export const GENERIC_ERROR_MESSAGE = MESSAGES.INTERNAL;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** First zod issue message, when the server included them. */
function firstIssue(details: unknown): string | null {
  const list = Array.isArray(details) ? details : record(details)?.issues;
  if (!Array.isArray(list)) return null;
  const first = record(list[0]);
  return typeof first?.message === 'string' ? first.message : null;
}

/** Friendly Italian message for any error thrown by the API layer. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error && err.message ? err.message : MESSAGES.INTERNAL;
  }
  const details = record(err.details);
  switch (err.code) {
    case 'RG_LOSS_LIMIT': {
      const period = typeof details?.period === 'string' ? details.period : null;
      const remaining = typeof details?.remaining === 'number' ? details.remaining : null;
      const periodText = period ? ` ${PERIOD_LABELS[period] ?? period}` : '';
      const remainingText =
        remaining !== null
          ? remaining > 0
            ? ` Puoi ancora puntare al massimo ${chipsLabel(remaining)} in questo periodo.`
            : ' Hai raggiunto il limite: potrai puntare di nuovo quando la finestra si libera.'
          : '';
      return `Questa puntata supererebbe il tuo limite di perdita${periodText}.${remainingText}`;
    }
    case 'RG_SELF_EXCLUDED': {
      const until = typeof details?.until === 'string' ? details.until : null;
      return until
        ? `È attiva una pausa di autoesclusione fino al ${formatDateTimeLong(until)}: fino ad allora non puoi puntare.`
        : MESSAGES.RG_SELF_EXCLUDED;
    }
    case 'BET_LIMIT':
      // The server message (Italian) says which limit was hit.
      return err.message && err.message !== MESSAGES.BET_LIMIT
        ? `${MESSAGES.BET_LIMIT} ${err.message}`
        : MESSAGES.BET_LIMIT;
    case 'VALIDATION_ERROR': {
      const issue = firstIssue(err.details);
      return issue ? `${MESSAGES.VALIDATION_ERROR} (${issue})` : MESSAGES.VALIDATION_ERROR;
    }
    default:
      return MESSAGES[err.code] ?? err.message ?? MESSAGES.INTERNAL;
  }
}

export function errorCode(err: unknown): ErrorCode | ClientErrorCode | null {
  return err instanceof ApiError ? err.code : null;
}

/**
 * No valid answer arrived (network failure, unreadable body, 5xx): the server may or may not
 * have applied the request, so the local view of balance and history can be stale.
 */
export function isUncertainOutcome(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.code === 'NETWORK_ERROR' || err.code === 'BAD_RESPONSE' || err.status >= 500)
  );
}

/** Shown on a table when a bet request ended without a definitive answer. */
export const UNCERTAIN_BET_MESSAGE =
  'Esito incerto: la puntata potrebbe essere stata registrata. Controlla lo storico; se riprovi con la stessa puntata non verrà addebitata due volte.';

/** Error text for a bet request: uncertain outcomes explain that a retry is safe. */
export function betErrorMessage(err: unknown): string {
  return isUncertainOutcome(err) ? UNCERTAIN_BET_MESSAGE : errorMessage(err);
}
