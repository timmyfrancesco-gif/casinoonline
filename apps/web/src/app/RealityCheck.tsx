import { useEffect, useState } from 'react';
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
 * The acknowledged threshold is kept per session so a reload does not skip a due check.
 */
export function RealityCheck() {
  const { data: me } = useMe();
  const rgQuery = useRg(Boolean(me));
  const { signOut, isPending: signingOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const rg = rgQuery.data;
  const intervalMs = (rg?.realityCheckMinutes ?? 30) * 60_000;
  const sessionKey = rg ? `${ACK_PREFIX}${rg.session.startedAt}` : null;
  // Session start on the client clock (elapsedMs avoids clock skew with the server).
  const startClient = rg ? rgQuery.dataUpdatedAt - rg.session.elapsedMs : null;
  const { refetch } = rgQuery;

  useEffect(() => {
    if (!sessionKey || startClient === null || open) return undefined;
    const acknowledged = Number(readStorage(sessionKey, 'session') ?? '0') || 0;
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
  }, [sessionKey, startClient, intervalMs, open, refetch]);

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

  const onContinue = () => {
    if (sessionKey) writeStorage(sessionKey, String(Date.now() - startClient), 'session');
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
          Le fiches sono virtuali. Fai una pausa quando vuoi: puoi cambiare la frequenza di questo
          promemoria nella pagina Gioco responsabile.
        </p>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onContinue} data-autofocus>
          Continua a giocare
        </button>
        <button type="button" className="btn" onClick={onExit} disabled={signingOut}>
          Esci
        </button>
      </div>
    </Modal>
  );
}
