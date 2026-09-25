import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { UNITS_PER_CHIP } from '@casino/engine';
import {
  HELPLINE,
  LOSS_LIMIT_PERIODS,
  REALITY_CHECK_OPTIONS,
  SELF_EXCLUSION_DURATIONS,
  type LossLimitPeriod,
  type LossLimitState,
  type RealityCheckMinutes,
  type RgStatus,
  type SelfExclusionDuration,
} from '@casino/shared';
import { useMe, useRg, useSelfExclude, useSetLossLimit, useSetRealityCheck } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { Modal } from '../components/Modal.tsx';
import { PageLoader } from '../components/Spinner.tsx';
import { chipsLabel, formatDateTimeLong } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

export const PERIOD_LABELS: Record<LossLimitPeriod, string> = {
  '24h': '24 ore',
  '7d': '7 giorni',
  '30d': '30 giorni',
};

const DURATION_LABELS: Record<SelfExclusionDuration, string> = {
  '24h': '24 ore',
  '7d': '7 giorni',
  '30d': '30 giorni',
};

const CONFIRM_WORD = 'PAUSA';

function LossLimitRow({ period, state }: { period: LossLimitPeriod; state: LossLimitState }) {
  const mutation = useSetLossLimit();
  const [value, setValue] = useState(
    state.value !== null ? String(state.value / UNITS_PER_CHIP) : '',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputId = `limit-${period}`;

  const submit = (next: number | null) => {
    setMessage(null);
    setLocalError(null);
    mutation.mutate(
      { period, value: next },
      {
        onSuccess: (rg) => {
          const s = rg.lossLimits[period];
          setValue(s.value !== null ? String(s.value / UNITS_PER_CHIP) : '');
          setMessage(
            s.pending
              ? `Richiesta registrata: entrerà in vigore il ${formatDateTimeLong(s.pending.effectiveAt)}.`
              : 'Limite aggiornato: è già in vigore.',
          );
        },
      },
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const chips = Number(value);
    if (!Number.isInteger(chips) || chips < 1) {
      setLocalError('Inserisci un numero intero di fiches (almeno 1).');
      return;
    }
    submit(chips * UNITS_PER_CHIP);
  };

  const usedPct =
    state.value && state.value > 0
      ? Math.min(100, Math.round((state.used / state.value) * 100))
      : 0;

  return (
    <li className="limit-row">
      <div className="limit-head">
        <h3>Limite di {PERIOD_LABELS[period]}</h3>
        <p className="limit-current">
          {state.value === null ? 'Nessun limite' : `In vigore: ${chipsLabel(state.value)}`}
        </p>
      </div>
      <dl className="limit-usage">
        <div>
          <dt>Perdita netta nel periodo</dt>
          <dd>{chipsLabel(state.used)}</dd>
        </div>
        <div>
          <dt>Ancora disponibile</dt>
          <dd>{state.remaining === null ? '—' : chipsLabel(state.remaining)}</dd>
        </div>
      </dl>
      {state.value !== null && (
        <div
          className="meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usedPct}
          aria-label={`Limite di ${PERIOD_LABELS[period]} utilizzato al ${usedPct}%`}
        >
          <span className="meter-fill" style={{ width: `${usedPct}%` }} />
        </div>
      )}
      {state.pending && (
        <p className="pending-note">
          In attesa:{' '}
          {state.pending.value === null
            ? 'rimozione del limite'
            : `nuovo limite di ${chipsLabel(state.pending.value)}`}{' '}
          dal {formatDateTimeLong(state.pending.effectiveAt)}. Gli aumenti e le rimozioni diventano
          effettivi dopo 24 ore; puoi annullarli impostando di nuovo un limite più basso.
        </p>
      )}
      <form className="limit-form" onSubmit={onSubmit} noValidate>
        <div className="field field-inline">
          <label htmlFor={inputId}>Nuovo limite (fiches)</label>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={localError ? true : undefined}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          Salva
        </button>
        {state.value !== null && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={mutation.isPending}
            onClick={() => submit(null)}
          >
            Rimuovi limite
          </button>
        )}
      </form>
      {localError && <p className="field-error">{localError}</p>}
      {mutation.isError && <Alert tone="error">{errorMessage(mutation.error)}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
    </li>
  );
}

function SelfExclusionSection({ rg }: { rg: RgStatus }) {
  const mutation = useSelfExclude();
  const [duration, setDuration] = useState<SelfExclusionDuration>('24h');
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [understood, setUnderstood] = useState(false);
  const until = rg.selfExclusion.until;
  const active = until !== null && new Date(until).getTime() > Date.now();

  const close = () => {
    setOpen(false);
    setConfirmText('');
    setUnderstood(false);
  };

  const confirm = () => {
    mutation.mutate({ duration }, { onSuccess: close });
  };

  return (
    <section className="panel" aria-labelledby="exclusion-title">
      <h2 id="exclusion-title" className="panel-title">
        Pausa (autoesclusione)
      </h2>
      <p>
        Durante la pausa puoi accedere e consultare storico e statistiche, ma non puoi puntare. La
        pausa <strong>non si può accorciare né annullare</strong>; una nuova pausa può solo
        allungarla.
      </p>
      {active && (
        <Alert tone="warning" title="Pausa attiva">
          Fino al {formatDateTimeLong(until)}.
        </Alert>
      )}
      <fieldset className="field">
        <legend>Durata</legend>
        <div className="segmented">
          {SELF_EXCLUSION_DURATIONS.map((d) => (
            <label key={d} className="segmented-option">
              <input
                type="radio"
                name="exclusion-duration"
                value={d}
                checked={duration === d}
                onChange={() => setDuration(d)}
              />
              <span>{DURATION_LABELS[d]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Prendi una pausa di {DURATION_LABELS[duration]}
      </button>
      {mutation.isSuccess && !open && (
        <Alert tone="success">Pausa attivata. Prenditi il tempo che ti serve.</Alert>
      )}

      <Modal
        open={open}
        title="Confermi la pausa?"
        onClose={close}
        describedBy="exclusion-confirm-text"
      >
        <div id="exclusion-confirm-text">
          <p>
            Per <strong>{DURATION_LABELS[duration]}</strong> non potrai iniziare nuove partite. Non
            potrai annullare né accorciare la pausa.
          </p>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span>Ho capito che la pausa non si può annullare.</span>
        </label>
        <div className="field">
          <label htmlFor="exclusion-confirm-word">
            Scrivi <strong>{CONFIRM_WORD}</strong> per confermare
          </label>
          <input
            id="exclusion-confirm-word"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            data-autofocus
          />
        </div>
        {mutation.isError && <Alert tone="error">{errorMessage(mutation.error)}</Alert>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={
              !understood || confirmText.trim().toUpperCase() !== CONFIRM_WORD || mutation.isPending
            }
            onClick={confirm}
          >
            Conferma la pausa
          </button>
          <button type="button" className="btn" onClick={close}>
            Annulla
          </button>
        </div>
      </Modal>
    </section>
  );
}

function RealityCheckSection({ rg }: { rg: RgStatus }) {
  const mutation = useSetRealityCheck();
  // The choice is shown while it is saved (the controlled radio would snap back until the reply).
  const [saving, setSaving] = useState<RealityCheckMinutes | null>(null);
  const selected = saving ?? rg.realityCheckMinutes;
  const choose = (minutes: RealityCheckMinutes) => {
    setSaving(minutes);
    mutation.mutate({ minutes }, { onSettled: () => setSaving(null) });
  };
  return (
    <section className="panel" aria-labelledby="reality-title">
      <h2 id="reality-title" className="panel-title">
        Promemoria di gioco (reality check)
      </h2>
      <p>
        A intervalli regolari ti mostriamo da quanto tempo stai giocando, quante partite hai fatto e
        il risultato netto della sessione.
      </p>
      <fieldset className="field" disabled={saving !== null}>
        <legend>Mostra il promemoria ogni</legend>
        <div className="segmented">
          {REALITY_CHECK_OPTIONS.map((m) => (
            <label key={m} className="segmented-option">
              <input
                type="radio"
                name="reality-minutes"
                value={m}
                checked={selected === m}
                onChange={() => choose(m)}
              />
              <span>{m} minuti</span>
            </label>
          ))}
        </div>
      </fieldset>
      {mutation.isError && <Alert tone="error">{errorMessage(mutation.error)}</Alert>}
      {mutation.isSuccess && <Alert tone="success">Frequenza aggiornata.</Alert>}
    </section>
  );
}

function RgSettings() {
  const query = useRg();
  if (query.isPending) return <PageLoader />;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const rg = query.data;
  return (
    <>
      <section className="panel" aria-labelledby="limits-title">
        <h2 id="limits-title" className="panel-title">
          Limiti di perdita
        </h2>
        <p>
          Il limite considera la perdita netta (puntate meno rientri) nelle ultime 24 ore, 7 giorni
          o 30 giorni. Una puntata che potrebbe superarlo viene rifiutata.{' '}
          <strong>Abbassare</strong> o impostare un limite ha effetto subito;{' '}
          <strong>alzarlo o rimuoverlo</strong> ha effetto dopo 24 ore. Ricominciare con il saldo
          iniziale non azzera il conteggio.
        </p>
        <ul className="limit-list">
          {LOSS_LIMIT_PERIODS.map((p) => (
            <LossLimitRow key={p} period={p} state={rg.lossLimits[p]} />
          ))}
        </ul>
      </section>
      <SelfExclusionSection rg={rg} />
      <RealityCheckSection rg={rg} />
    </>
  );
}

export function ResponsibleGamingPage() {
  usePageTitle('Gioco responsabile');
  const { data: me, isPending } = useMe();
  return (
    <div className="page rg-page">
      <h1>Gioco responsabile</h1>
      <div className="rg-intro">
        <section className="panel helpline-panel" aria-labelledby="help-title">
          <h2 id="help-title" className="panel-title">
            Hai bisogno di parlarne?
          </h2>
          <p>
            {HELPLINE.name}:{' '}
            <a href={`tel:${HELPLINE.phone.replace(/\s/g, '')}`} className="helpline-number">
              {HELPLINE.phone}
            </a>
          </p>
          <p className="small">Gratuito e anonimo. Risponde personale specializzato.</p>
        </section>
        <section className="panel" aria-labelledby="tips-title">
          <h2 id="tips-title" className="panel-title">
            Qualche regola di buon senso
          </h2>
          <ul className="plain-list bullets">
            <li>
              Il gioco è un passatempo, non un modo per guadagnare: qui le fiches non valgono nulla.
            </li>
            <li>Nel lungo periodo il banco vince sempre: ogni tavolo mostra il suo vantaggio.</li>
            <li>
              Nessuna strategia batte la roulette o la slot; gli esiti passati non influenzano i
              futuri.
            </li>
            <li>Decidi prima quanto tempo dedicare al gioco e fai pause frequenti.</li>
            <li>
              Se ti accorgi di giocare per recuperare le perdite, di nasconderlo o di pensarci
              spesso, parlane con qualcuno.
            </li>
          </ul>
        </section>
      </div>
      {isPending ? (
        <PageLoader />
      ) : me ? (
        <RgSettings />
      ) : (
        <Alert tone="info">
          <Link to="/accedi" state={{ from: '/gioco-responsabile' }}>
            Accedi
          </Link>{' '}
          per impostare limiti di perdita, pause e promemoria.
        </Alert>
      )}
    </div>
  );
}
