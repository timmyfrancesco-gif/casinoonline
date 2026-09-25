import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { HELPLINE } from '@casino/shared';
import { useMe, useRg } from '../api/hooks.ts';
import { NetAmount } from '../components/Amount.tsx';
import { Modal } from '../components/Modal.tsx';
import { formatDuration, pluralize } from '../lib/format.ts';
import { readStorage, writeStorage } from '../lib/storage.ts';
import { useSignOut } from './useSignOut.ts';

const ACK_PREFIX = 'casino-rc-ack:';

/** Next check time (elapsed ms since session start) after the last acknowledged one. */
export function nextRealityCheckDue(acknowledgedElapsedMs: number, intervalMs: number): number {
  return (Math.floor(acknowledgedElapsedMs / intervalMs) + 1) * intervalMs;
}

/**
 * Reality check: every `realityCheckMinutes` of session a blocking dialog shows the elapsed
 * time, rounds played and net result. The player continues or logs out.
 * The acknowledged threshold is kept per session so a reload does not skip a due check; it is
 * also held in memory, so the dialog can be dismissed when Web Storage is unavailable.
 */
export function RealityCheck() {
  const { data: me } = useMe();
  const rgQuery = useRg(Boolean(me));
  const { signOut, isPending: signingOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Last acknowledged elapsed time of this session (storage may be blocked or throw).
  const [ack, setAck] = useState<{ key: string; ms: number } | null>(null);

  const rg = rgQuery.data;
  const intervalMs = (rg?.realityCheckMinutes ?? 30) * 60_000;
  const sessionKey = rg ? `${ACK_PREFIX}${rg.session.startedAt}` : null;
  // Session start on the client clock (elapsedMs avoids clock skew with the server).
  const startClient = rg ? rgQuery.dataUpdatedAt - rg.session.elapsedMs : null;
  const { refetch } = rgQuery;

  useEffect(() => {
    if (!sessionKey || startClient === null || open) return undefined;
    const acknowledged = Math.max(
      ack?.key === sessionKey ? ack.ms : 0,
      Number(readStorage(sessionKey, 'session') ?? '0') || 0,
    );
    const dueAt = startClient + nextRealityCheckDue(acknowledged, intervalMs);
    const timer = window.setTimeout(
      () => {
        void refetch();
        setNow(Date.now());
        setOpen(true);
      },
      Math.max(0, dueAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [sessionKey, startClient, intervalMs, open, refetch, ack]);

  useEffect(() => {
    if (!open) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [open]);

  // Logged out (elsewhere, or session expired): nothing to check.
  useEffect(() => {
    if (!me) setOpen(false);
  }, [me]);

  if (!me || !rg || startClient === null) return null;
  const elapsed = now - startClient;

  // Continuing (or opening the RG tools) acknowledges the check until the next interval.
  const acknowledge = () => {
    if (sessionKey) {
      const ms = Date.now() - startClient;
      setAck({ key: sessionKey, ms });
      writeStorage(sessionKey, String(ms), 'session');
    }
    setOpen(false);
  };
  const onExit = () => {
    setOpen(false);
    signOut();
  };

  return (
    <Modal open={open} title="Promemoria di gioco" describedBy="reality-check-text">
      <div id="reality-check-text">
        <p>
          Stai giocando da <strong>{formatDuration(elapsed)}</strong>. Ecco il riepilogo di questa
          sessione:
        </p>
        <dl className="summary-list">
          <div>
            <dt>Tempo di gioco</dt>
            <dd>{formatDuration(elapsed)}</dd>
          </div>
          <div>
            <dt>Partite giocate</dt>
            <dd>{pluralize(rg.session.rounds, 'partita', 'partite')}</dd>
          </div>
          <div>
            <dt>Risultato netto</dt>
            <dd>
              <NetAmount value={rg.session.net} />
            </dd>
          </div>
        </dl>
        <p className="muted">
          Le fiches sono virtuali. Fai una pausa quando vuoi: nella pagina{' '}
          <Link to="/gioco-responsabile" onClick={acknowledge}>
            Gioco responsabile
          </Link>{' '}
          puoi impostare limiti di perdita, una pausa di autoesclusione o la frequenza di questo
          promemoria.
        </p>
        <p className="small">
          Se il gioco non è più un divertimento: {HELPLINE.name},{' '}
          <a href={`tel:${HELPLINE.phone.replace(/\s/g, '')}`} className="helpline-number">
            {HELPLINE.phone}
          </a>{' '}
          (gratuito e anonimo).
        </p>
      </div>
      {/* Same weight for both choices, and no autofocus: the dialog itself takes focus so a
          stray Enter or Space does not dismiss the check unread. */}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onExit} disabled={signingOut}>
          Esci
        </button>
        <button type="button" className="btn" onClick={acknowledge}>
          Continua a giocare
        </button>
      </div>
    </Modal>
  );
}
