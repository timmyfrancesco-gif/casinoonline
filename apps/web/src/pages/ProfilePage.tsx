import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CLIENT_SEED_PATTERN, GAME_IDS, GAME_NAMES_IT, STARTING_BALANCE } from '@casino/engine';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type GameStats } from '@casino/shared';
import {
  useChangePassword,
  useClearSession,
  useDeleteAccount,
  useFairness,
  useMe,
  useResetWallet,
  useRotateSeeds,
  useStats,
} from '../api/hooks.ts';
import { errorCode, errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { NetAmount } from '../components/Amount.tsx';
import { Field } from '../components/Field.tsx';
import { Modal } from '../components/Modal.tsx';
import { PageLoader } from '../components/Spinner.tsx';
import { randomClientSeed } from '../lib/clientSeed.ts';
import { chipsLabel, formatDateTime, formatDateTimeLong, pluralize } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { useLeaveToLobby } from '../app/useSignOut.ts';

function StatsRow({ label, stats }: { label: string; stats: GameStats }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{stats.rounds.toLocaleString('it-IT')}</td>
      <td className="num">{chipsLabel(stats.wagered)}</td>
      <td className="num">{chipsLabel(stats.returned)}</td>
      <td className="num">
        <NetAmount value={stats.net} suffix={false} />
      </td>
      <td className="num">
        {stats.wagered > 0
          ? `${((stats.returned / stats.wagered) * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`
          : '—'}
      </td>
    </tr>
  );
}

function StatsSection() {
  const query = useStats();
  return (
    <section className="panel" aria-labelledby="stats-title">
      <h2 id="stats-title" className="panel-title">
        Statistiche
      </h2>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : (
        <>
          <dl className="stat-cards">
            <div className="stat-card">
              <dt>Partite giocate</dt>
              <dd>{query.data.lifetime.rounds.toLocaleString('it-IT')}</dd>
            </div>
            <div className="stat-card">
              <dt>Totale puntato</dt>
              <dd>{chipsLabel(query.data.lifetime.wagered)}</dd>
            </div>
            <div className="stat-card">
              <dt>Risultato netto</dt>
              <dd>
                <NetAmount value={query.data.lifetime.net} />
              </dd>
            </div>
            <div className="stat-card">
              <dt>Ripartenze del saldo</dt>
              <dd>{query.data.resets}</dd>
            </div>
          </dl>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="small muted">
                «Rientro» comprende la puntata restituita. Il ritorno effettivo oscilla intorno
                all’RTP teorico solo su moltissime partite.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Periodo / gioco</th>
                  <th scope="col" className="num">
                    Partite
                  </th>
                  <th scope="col" className="num">
                    Puntato
                  </th>
                  <th scope="col" className="num">
                    Rientro
                  </th>
                  <th scope="col" className="num">
                    Netto
                  </th>
                  <th scope="col" className="num">
                    Ritorno
                  </th>
                </tr>
              </thead>
              <tbody>
                <StatsRow
                  label={`Sessione (dalle ${formatDateTime(query.data.session.startedAt)})`}
                  stats={query.data.session}
                />
                <StatsRow label="Da sempre" stats={query.data.lifetime} />
                {GAME_IDS.map((g) => (
                  <StatsRow key={g} label={GAME_NAMES_IT[g]} stats={query.data.byGame[g]} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function WalletSection() {
  const { data: me } = useMe();
  const reset = useResetWallet();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const allowed = me.balance < STARTING_BALANCE;
  return (
    <section className="panel" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="panel-title">
        Saldo
      </h2>
      <p className="big-balance">{chipsLabel(me.balance)}</p>
      <p className="small muted">
        Se il saldo scende sotto {chipsLabel(STARTING_BALANCE)} puoi ricominciare da capo. Le
        statistiche e i limiti di perdita restano invariati.
      </p>
      <button
        type="button"
        className="btn"
        disabled={!allowed || reset.isPending}
        onClick={() => setOpen(true)}
      >
        Ricomincia con {chipsLabel(STARTING_BALANCE)}
      </button>
      {!allowed && (
        <p className="small muted">Disponibile solo con saldo inferiore a quello iniziale.</p>
      )}
      {reset.isError && <Alert tone="error">{errorMessage(reset.error)}</Alert>}
      {reset.isSuccess && (
        <Alert tone="success">Saldo riportato a {chipsLabel(STARTING_BALANCE)}.</Alert>
      )}
      <Modal open={open} title="Ricominciare da capo?" onClose={() => setOpen(false)}>
        <p>
          Il saldo tornerà a {chipsLabel(STARTING_BALANCE)}. Le fiches sono virtuali: la ripartenza
          viene conteggiata nelle statistiche e non azzera i limiti di perdita.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-autofocus
            onClick={() => reset.mutate(undefined, { onSettled: () => setOpen(false) })}
            disabled={reset.isPending}
          >
            Ricomincia
          </button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Annulla
          </button>
        </div>
      </Modal>
    </section>
  );
}

function SeedsSection() {
  const query = useFairness();
  const rotate = useRotateSeeds();
  const [clientSeed, setClientSeed] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);

  const onRotate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = clientSeed.trim();
    if (value && !CLIENT_SEED_PATTERN.test(value)) {
      setSeedError('Da 1 a 64 caratteri stampabili, senza spazi né «:».');
      return;
    }
    setSeedError(null);
    // Always a client seed chosen on this side: a server-generated one would let the server
    // pick both inputs of the HMAC. The next-seed hash on screen binds the server to that seed.
    rotate.mutate(
      {
        clientSeed: value || randomClientSeed(),
        nextServerSeedHash: query.data?.next.serverSeedHash,
      },
      { onSuccess: () => setClientSeed('') },
    );
  };
  const promised = rotate.isSuccess ? rotate.variables.nextServerSeedHash : undefined;

  return (
    <section className="panel" aria-labelledby="seed-title" id="seed">
      <h2 id="seed-title" className="panel-title">
        Seed provably fair
      </h2>
      <p>
        Ogni partita usa il seed del server, il tuo seed client e un nonce che cresce di 1 a ogni
        partita. Del seed del server vedi solo l’impronta: ruotando i seed viene rivelato e puoi{' '}
        <Link to="/verifica">verificare</Link> tutte le partite giocate con quella coppia. Anche il
        seed server della coppia successiva è già fissato: ne vedi l’hash prima di scegliere il
        nuovo seed client.
      </p>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : (
        <>
          <h3 className="panel-subtitle">Coppia attiva</h3>
          <dl className="kv-list">
            <div>
              <dt>Impronta del seed server (SHA-256)</dt>
              <dd className="mono">{query.data.active.serverSeedHash}</dd>
            </div>
            <div>
              <dt>Seed client</dt>
              <dd className="mono">{query.data.active.clientSeed}</dd>
            </div>
            <div>
              <dt>Prossimo nonce</dt>
              <dd className="mono">{query.data.active.nextNonce}</dd>
            </div>
          </dl>
          <h3 className="panel-subtitle">Prossima coppia</h3>
          <dl className="kv-list">
            <div>
              <dt>Hash del prossimo seed server</dt>
              <dd className="mono">{query.data.next.serverSeedHash}</dd>
            </div>
          </dl>
          <p className="small muted">
            Il seed server della prossima coppia è stato generato in anticipo e non può più
            cambiare. Alla rotazione diventa il seed della coppia attiva, con il seed client che
            scegli ora: la sua impronta deve coincidere con questo hash, quindi il server non può
            scegliere il proprio seed dopo aver visto il tuo.
          </p>
          <form className="form form-inline" onSubmit={onRotate} noValidate>
            <Field
              label="Nuovo seed client (facoltativo)"
              value={clientSeed}
              onChange={(e) => setClientSeed(e.target.value)}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              hint="Se lo lasci vuoto ne generiamo uno casuale nel tuo browser."
              error={seedError}
            />
            <button type="submit" className="btn btn-primary" disabled={rotate.isPending}>
              Ruota i seed e rivela quello attuale
            </button>
          </form>
          {rotate.isError && (
            <Alert tone="error">
              {errorCode(rotate.error) === 'CONFLICT'
                ? 'I seed sono stati ruotati nel frattempo, ad esempio da un’altra scheda: controlla il nuovo hash del prossimo seed server e riprova.'
                : errorMessage(rotate.error)}
            </Alert>
          )}
          {rotate.isSuccess && query.data.revealed[0] && (
            <Alert tone="success" title="Seed rivelato">
              <span className="mono break">{query.data.revealed[0].serverSeed}</span>
            </Alert>
          )}
          {promised &&
            (rotate.data?.active.serverSeedHash === promised ? (
              <Alert tone="success">
                La nuova coppia attiva usa il seed server annunciato: la sua impronta coincide con
                l’hash mostrato prima della rotazione.
              </Alert>
            ) : (
              <Alert tone="error" title="✗ Seed server diverso da quello annunciato">
                Prima della rotazione il server aveva annunciato l’hash{' '}
                <span className="mono break">{promised}</span>, ma la nuova coppia attiva ha
                l’impronta <span className="mono break">{rotate.data?.active.serverSeedHash}</span>.
                La verifica delle sue partite userà l’hash annunciato.
              </Alert>
            ))}

          <h3 className="panel-subtitle">Coppie rivelate</h3>
          {query.data.revealed.length === 0 ? (
            <p className="muted">Nessuna coppia rivelata finora.</p>
          ) : (
            <ul className="revealed-list">
              {query.data.revealed.map((pair) => {
                const params = new URLSearchParams({
                  serverSeed: pair.serverSeed,
                  clientSeed: pair.clientSeed,
                  hash: pair.serverSeedHash,
                  // The verifier prefers the hash this browser recorded for the pair.
                  pair: pair.id,
                });
                return (
                  <li key={pair.id} className="revealed-item">
                    <dl className="kv-list compact">
                      <div>
                        <dt>Seed server</dt>
                        <dd className="mono break">{pair.serverSeed}</dd>
                      </div>
                      <div>
                        <dt>Impronta</dt>
                        <dd className="mono break">{pair.serverSeedHash}</dd>
                      </div>
                      <div>
                        <dt>Seed client</dt>
                        <dd className="mono break">{pair.clientSeed}</dd>
                      </div>
                      <div>
                        <dt>Partite</dt>
                        <dd>
                          {pluralize(pair.roundsPlayed, 'partita', 'partite')}
                          {pair.roundsPlayed > 0 && ` (nonce 0–${pair.roundsPlayed - 1})`}
                        </dd>
                      </div>
                      <div>
                        <dt>Rivelata</dt>
                        <dd>{formatDateTimeLong(pair.revealedAt)}</dd>
                      </div>
                    </dl>
                    <Link to={`/verifica?${params.toString()}`} className="btn btn-small">
                      Verifica con questa coppia
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function PasswordSection() {
  const mutation = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!current) return setError('Inserisci la password attuale.');
    if (next.length < PASSWORD_MIN_LENGTH) {
      return setError(`La nuova password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`);
    }
    if (next !== confirm) return setError('Le due password nuove non coincidono.');
    mutation.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
        },
      },
    );
  };

  return (
    <section className="panel" aria-labelledby="password-title">
      <h2 id="password-title" className="panel-title">
        Cambia password
      </h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field
          label="Password attuale"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          maxLength={PASSWORD_MAX_LENGTH}
        />
        <Field
          label="Nuova password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          maxLength={PASSWORD_MAX_LENGTH}
          hint={`Almeno ${PASSWORD_MIN_LENGTH} caratteri.`}
        />
        <Field
          label="Conferma nuova password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={PASSWORD_MAX_LENGTH}
        />
        {error && <Alert tone="error">{error}</Alert>}
        {mutation.isError && (
          <Alert tone="error">
            {errorCode(mutation.error) === 'INVALID_CREDENTIALS'
              ? 'La password attuale non è corretta.'
              : errorMessage(mutation.error)}
          </Alert>
        )}
        {mutation.isSuccess && (
          <Alert tone="success">Password aggiornata. Le altre sessioni sono state chiuse.</Alert>
        )}
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          Aggiorna password
        </button>
      </form>
    </section>
  );
}

function DeleteSection() {
  const mutation = useDeleteAccount();
  const clearSession = useClearSession();
  const leaveToLobby = useLeaveToLobby();
  const [password, setPassword] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <section className="panel danger-zone" aria-labelledby="delete-title">
      <h2 id="delete-title" className="panel-title">
        Elimina account
      </h2>
      <p>
        L’eliminazione è immediata e definitiva: cancelliamo account, partite, statistiche e
        impostazioni.
      </p>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Elimina il mio account
      </button>
      <Modal
        open={open}
        title="Eliminare definitivamente l’account?"
        onClose={() => {
          setOpen(false);
          setPassword('');
        }}
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return;
            mutation.mutate(
              { password },
              { onSuccess: () => leaveToLobby(clearSession, { replace: true }) },
            );
          }}
        >
          <p>Questa operazione non si può annullare. Inserisci la password per confermare.</p>
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-autofocus
          />
          {mutation.isError && (
            <Alert tone="error">
              {errorCode(mutation.error) === 'INVALID_CREDENTIALS'
                ? 'Password non corretta.'
                : errorMessage(mutation.error)}
            </Alert>
          )}
          <div className="modal-actions">
            <button
              type="submit"
              className="btn btn-danger"
              disabled={!password || mutation.isPending}
            >
              Elimina definitivamente
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                setPassword('');
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export function ProfilePage() {
  usePageTitle('Profilo');
  const { data: me } = useMe();
  return (
    <div className="page profile-page">
      <h1>Profilo</h1>
      {me && (
        <p className="muted">
          {me.user.username} · iscritto dal {formatDateTimeLong(me.user.createdAt)}
        </p>
      )}
      <div className="profile-grid">
        <WalletSection />
        <StatsSection />
        <SeedsSection />
        <PasswordSection />
        <DeleteSection />
      </div>
    </div>
  );
}
