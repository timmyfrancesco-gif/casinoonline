import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  BLACKJACK_ACTIONS,
  CLIENT_SEED_PATTERN,
  GAME_IDS,
  GAME_NAMES_IT,
  SERVER_SEED_PATTERN,
  UNITS_PER_CHIP,
  VIDEO_POKER_HAND_NAMES_IT,
  hashServerSeed,
  verifyRound,
  type BlackjackAction,
  type GameId,
  type RouletteBet,
  type VerifyInput,
  type VerifyResult,
} from '@casino/engine';
import type { RoundDetailResponse } from '@casino/shared';
import { useMe, useRoundDetail } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { Field } from '../components/Field.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { ACTION_LABELS, OUTCOME_SHORT } from '../games/blackjack/labels.ts';
import { COLOR_NAMES_IT, betLabel, numberColor, targetOf } from '../games/roulette/betBuilder.ts';
import { SYMBOL_NAMES_IT, WIN_NAMES_IT } from '../games/slot/symbols.tsx';
import { chipsLabel } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

interface FormState {
  game: GameId;
  serverSeed: string;
  expectedHash: string;
  clientSeed: string;
  nonce: string;
  /** Roulette bets as JSON (amounts in units). */
  bets: string;
  /** Stake in whole chips (slot, blackjack, video poker). */
  bet: string;
  /** Blackjack actions, comma separated. */
  actions: string;
  held: boolean[];
}

const EMPTY: FormState = {
  game: 'roulette',
  serverSeed: '',
  expectedHash: '',
  clientSeed: '',
  nonce: '0',
  bets: '[{"type":"red","amount":100}]',
  bet: '1',
  actions: '',
  held: [false, false, false, false, false],
};

const ACTION_ALIASES: Record<string, BlackjackAction> = {
  hit: 'hit',
  carta: 'hit',
  stand: 'stand',
  stai: 'stand',
  double: 'double',
  raddoppia: 'double',
  split: 'split',
  dividi: 'split',
};

export function formFromRound(data: RoundDetailResponse): FormState {
  const f = data.round.fairness;
  const base: FormState = {
    ...EMPTY,
    game: data.round.game,
    serverSeed: f.serverSeed ?? '',
    expectedHash: f.serverSeedHash,
    clientSeed: f.clientSeed,
    nonce: String(f.nonce),
  };
  const input = data.verifyInput;
  if (!input) return base;
  switch (input.game) {
    case 'roulette':
      return { ...base, bets: JSON.stringify(input.bets) };
    case 'slot':
      return { ...base, bet: String(input.bet / UNITS_PER_CHIP) };
    case 'blackjack':
      return {
        ...base,
        bet: String(input.bet / UNITS_PER_CHIP),
        actions: input.actions.join(', '),
      };
    case 'videopoker':
      return { ...base, bet: String(input.bet / UNITS_PER_CHIP), held: [...input.held] };
  }
}

/** Builds the engine input from the form, or returns an Italian error. */
export function buildVerifyInput(form: FormState): { input: VerifyInput } | { error: string } {
  const chips = Number(form.bet.replace(',', '.'));
  const bet = Math.round(chips * UNITS_PER_CHIP);
  const betOk = Number.isFinite(chips) && chips > 0 && Number.isSafeInteger(bet);
  switch (form.game) {
    case 'roulette': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(form.bets);
      } catch {
        return { error: 'Le puntate della roulette devono essere in formato JSON valido.' };
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return { error: 'Inserisci almeno una puntata della roulette.' };
      }
      return { input: { game: 'roulette', bets: parsed as RouletteBet[] } };
    }
    case 'slot':
      return betOk ? { input: { game: 'slot', bet } } : { error: 'Puntata non valida.' };
    case 'blackjack': {
      if (!betOk) return { error: 'Puntata non valida.' };
      const words = form.actions
        .split(/[\s,;→>-]+/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
      const actions: BlackjackAction[] = [];
      for (const w of words) {
        const a = ACTION_ALIASES[w];
        if (!a) return { error: `Mossa sconosciuta: «${w}». Usa ${BLACKJACK_ACTIONS.join(', ')}.` };
        actions.push(a);
      }
      return { input: { game: 'blackjack', bet, actions } };
    }
    case 'videopoker':
      return betOk
        ? { input: { game: 'videopoker', bet, held: form.held } }
        : { error: 'Puntata non valida.' };
  }
}

/** Compares the recomputed outcome with what the server recorded. */
export function matchesRecorded(result: VerifyResult, data: RoundDetailResponse): boolean {
  const d = data.detail;
  switch (result.game) {
    case 'roulette':
      return (
        d.game === 'roulette' &&
        d.settlement.number === result.settlement.number &&
        d.settlement.totalWin === result.settlement.totalWin
      );
    case 'slot':
      return (
        d.game === 'slot' &&
        d.settlement.stops.join() === result.settlement.stops.join() &&
        d.settlement.win === result.settlement.win
      );
    case 'blackjack':
      return (
        d.game === 'blackjack' &&
        (result.state.result?.totalPayout ?? -1) === data.round.payout &&
        d.state.dealer.cards.join() === result.state.dealer.join() &&
        d.state.hands.map((h) => h.cards.join()).join('|') ===
          result.state.hands.map((h) => h.cards.join()).join('|')
      );
    case 'videopoker':
      return (
        d.game === 'videopoker' &&
        d.state.hand.join() === result.state.hand.join() &&
        (result.state.result?.payout ?? -1) === data.round.payout
      );
  }
}

function ResultView({ result }: { result: VerifyResult }) {
  switch (result.game) {
    case 'roulette': {
      const s = result.settlement;
      return (
        <>
          <p className="detail-headline">
            Numero: <span className={`number-badge rt-${numberColor(s.number)}`}>{s.number}</span>{' '}
            {COLOR_NAMES_IT[numberColor(s.number)]}
          </p>
          <ul className="plain-list">
            {s.bets.map((b, i) => (
              <li key={i}>
                {betLabel(targetOf(b.bet))}: {chipsLabel(b.bet.amount)} → rientro{' '}
                {chipsLabel(b.win)}
              </li>
            ))}
          </ul>
          <p>
            Totale puntato {chipsLabel(s.totalBet)} · rientro {chipsLabel(s.totalWin)}
          </p>
        </>
      );
    }
    case 'slot': {
      const s = result.settlement;
      return (
        <p>
          Fermate {s.stops.join(', ')} · linea {s.line.map((x) => SYMBOL_NAMES_IT[x]).join(', ')} ·{' '}
          {s.kind ? `${WIN_NAMES_IT[s.kind]} (×${s.multiplier})` : 'nessuna vincita'} · rientro{' '}
          {chipsLabel(s.win)}
        </p>
      );
    }
    case 'blackjack': {
      const s = result.state;
      return (
        <>
          <h3 className="panel-subtitle">Banco</h3>
          <div className="card-row">
            {s.dealer.map((c, i) => (
              <PlayingCard key={i} code={c} />
            ))}
          </div>
          {s.hands.map((h, i) => (
            <div key={i}>
              <h3 className="panel-subtitle">
                {s.hands.length > 1 ? `Mano ${i + 1}` : 'Giocatore'}
                {s.result?.hands[i] &&
                  ` — ${OUTCOME_SHORT[s.result.hands[i].outcome]}, rientro ${chipsLabel(s.result.hands[i].payout)}`}
              </h3>
              <div className="card-row">
                {h.cards.map((c, j) => (
                  <PlayingCard key={j} code={c} />
                ))}
              </div>
            </div>
          ))}
          <p>
            Mosse applicate: {s.actions.map((a) => ACTION_LABELS[a]).join(' → ') || 'nessuna'} ·{' '}
            {s.result
              ? `rientro totale ${chipsLabel(s.result.totalPayout)} su ${chipsLabel(s.result.totalBet)}`
              : 'mano non conclusa con queste mosse'}
          </p>
        </>
      );
    }
    case 'videopoker': {
      const s = result.state;
      return (
        <>
          <div className="card-row">
            {s.hand.map((c, i) => (
              <PlayingCard key={i} code={c} />
            ))}
          </div>
          <p>
            {s.result
              ? `${VIDEO_POKER_HAND_NAMES_IT[s.result.rank]} (×${s.result.multiplier}) · rientro ${chipsLabel(s.result.payout)}`
              : 'Mano non conclusa'}
          </p>
        </>
      );
    }
  }
}

interface Outcome {
  hash: string;
  hashMatches: boolean | null;
  result: VerifyResult | null;
  error: string | null;
  recordedMatch: boolean | null;
}

export function VerifyPage() {
  usePageTitle('Verifica');
  const [params] = useSearchParams();
  const roundId = params.get('round') ?? undefined;
  const { data: me } = useMe();
  const detail = useRoundDetail(me ? roundId : undefined);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const prefilledFor = useRef<string | null>(null);

  // Prefill from a revealed seed pair (links from the profile).
  useEffect(() => {
    const serverSeed = params.get('serverSeed');
    const clientSeed = params.get('clientSeed');
    if (!serverSeed && !clientSeed) return;
    setForm((f) => ({
      ...f,
      serverSeed: serverSeed ?? f.serverSeed,
      clientSeed: clientSeed ?? f.clientSeed,
      expectedHash: params.get('hash') ?? f.expectedHash,
      nonce: params.get('nonce') ?? f.nonce,
    }));
  }, [params]);

  useEffect(() => {
    if (!detail.data || prefilledFor.current === detail.data.round.id) return;
    prefilledFor.current = detail.data.round.id;
    setForm(formFromRound(detail.data));
    setOutcome(null);
  }, [detail.data]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const serverSeed = form.serverSeed.trim();
    const clientSeed = form.clientSeed.trim();
    const nonce = Number(form.nonce);
    if (!serverSeed)
      return setFormError('Inserisci il seed del server (rivelato dopo la rotazione).');
    if (!clientSeed) return setFormError('Inserisci il seed client.');
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      return setFormError('Il nonce deve essere un numero intero maggiore o uguale a 0.');
    }
    const built = buildVerifyInput(form);
    if ('error' in built) return setFormError(built.error);

    const hash = hashServerSeed(serverSeed);
    const expected = form.expectedHash.trim().toLowerCase();
    let result: VerifyResult | null = null;
    let error: string | null = null;
    try {
      result = verifyRound({ serverSeed, clientSeed, nonce }, built.input);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const recorded =
      detail.data && detail.data.round.id === prefilledFor.current ? detail.data : null;
    setOutcome({
      hash,
      hashMatches: expected ? hash === expected : null,
      result,
      error,
      recordedMatch: result && recorded ? matchesRecorded(result, recorded) : null,
    });
  };

  const seedWarning =
    form.serverSeed && !SERVER_SEED_PATTERN.test(form.serverSeed.trim())
      ? 'I seed del server sono 64 caratteri esadecimali minuscoli.'
      : null;
  const clientWarning =
    form.clientSeed && !CLIENT_SEED_PATTERN.test(form.clientSeed.trim())
      ? 'Seed client: 1-64 caratteri stampabili, senza spazi né «:».'
      : null;

  return (
    <div className="page">
      <h1>Verifica di una partita</h1>
      <p className="lead">
        Ogni esito è calcolato con HMAC-SHA256(seed server, «seed client:nonce:contatore»). Prima di
        giocare vedi solo l’impronta SHA-256 del seed server; dopo la rotazione il seed viene
        rivelato e qui puoi ricalcolare la partita direttamente nel tuo browser, senza contattare il
        server.
      </p>

      {roundId && !me && (
        <Alert tone="info">
          <Link to="/accedi" state={{ from: `/verifica?round=${roundId}` }}>
            Accedi
          </Link>{' '}
          per caricare automaticamente i dati della partita n. {roundId}.
        </Alert>
      )}
      {roundId && me && detail.isPending && <Spinner label="Caricamento della partita…" />}
      {detail.isError && <Alert tone="error">{errorMessage(detail.error)}</Alert>}
      {detail.data && !detail.data.round.fairness.serverSeed && (
        <Alert tone="warning" title="Seed non ancora rivelato">
          Questa partita usa la coppia di seed attiva. Ruota i seed nel{' '}
          <Link to="/profilo#seed">profilo</Link> per rivelare il seed del server, poi torna qui.
        </Alert>
      )}

      <div className="verify-layout">
        <form
          className="panel form"
          onSubmit={onSubmit}
          noValidate
          aria-labelledby="verify-form-title"
        >
          <h2 id="verify-form-title" className="panel-title">
            Dati della partita
          </h2>
          <div className="field">
            <label htmlFor="verify-game">Gioco</label>
            <select
              id="verify-game"
              value={form.game}
              onChange={(e) => update('game', e.target.value as GameId)}
            >
              {GAME_IDS.map((g) => (
                <option key={g} value={g}>
                  {GAME_NAMES_IT[g]}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Seed server (rivelato)"
            className="mono-input"
            value={form.serverSeed}
            onChange={(e) => update('serverSeed', e.target.value)}
            spellCheck={false}
            autoComplete="off"
            error={seedWarning}
          />
          <Field
            label="Impronta attesa (SHA-256 mostrata prima di giocare)"
            className="mono-input"
            value={form.expectedHash}
            onChange={(e) => update('expectedHash', e.target.value)}
            spellCheck={false}
            autoComplete="off"
            hint="Facoltativa: se la inserisci controlliamo che il seed rivelato corrisponda."
          />
          <Field
            label="Seed client"
            className="mono-input"
            value={form.clientSeed}
            onChange={(e) => update('clientSeed', e.target.value)}
            spellCheck={false}
            autoComplete="off"
            error={clientWarning}
          />
          <Field
            label="Nonce"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.nonce}
            onChange={(e) => update('nonce', e.target.value)}
          />

          {form.game === 'roulette' ? (
            <div className="field">
              <label htmlFor="verify-bets">Puntate (JSON, importi in unità: 100 = 1 fiche)</label>
              <textarea
                id="verify-bets"
                className="mono-input"
                rows={5}
                value={form.bets}
                spellCheck={false}
                onChange={(e) => update('bets', e.target.value)}
              />
            </div>
          ) : (
            <Field
              label="Puntata (fiches)"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.bet}
              onChange={(e) => update('bet', e.target.value)}
            />
          )}
          {form.game === 'blackjack' && (
            <Field
              label="Mosse, in ordine"
              value={form.actions}
              onChange={(e) => update('actions', e.target.value)}
              hint="Separate da virgola: hit (carta), stand (stai), double (raddoppia), split (dividi)."
            />
          )}
          {form.game === 'videopoker' && (
            <fieldset className="field">
              <legend>Carte tenute</legend>
              <div className="checkbox-row">
                {form.held.map((h, i) => (
                  <label key={i} className="toggle">
                    <input
                      type="checkbox"
                      checked={h}
                      onChange={(e) =>
                        update(
                          'held',
                          form.held.map((x, j) => (j === i ? e.target.checked : x)),
                        )
                      }
                    />
                    <span>Carta {i + 1}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {formError && <Alert tone="error">{formError}</Alert>}
          <button type="submit" className="btn btn-primary">
            Ricalcola
          </button>
        </form>

        <section className="panel" aria-labelledby="verify-result-title" aria-live="polite">
          <h2 id="verify-result-title" className="panel-title">
            Risultato della verifica
          </h2>
          {!outcome ? (
            <p className="muted">Compila i dati e premi «Ricalcola».</p>
          ) : (
            <>
              <dl className="kv-list">
                <div>
                  <dt>SHA-256 del seed inserito</dt>
                  <dd className="mono">{outcome.hash}</dd>
                </div>
                <div>
                  <dt>Corrisponde all’impronta?</dt>
                  <dd>
                    {outcome.hashMatches === null ? (
                      'Impronta non indicata'
                    ) : outcome.hashMatches ? (
                      <span className="badge badge-ok">✓ Sì, il seed è quello promesso</span>
                    ) : (
                      <span className="badge badge-ko">✗ No, il seed non corrisponde</span>
                    )}
                  </dd>
                </div>
                {outcome.recordedMatch !== null && (
                  <div>
                    <dt>Coincide con l’esito registrato?</dt>
                    <dd>
                      {outcome.recordedMatch ? (
                        <span className="badge badge-ok">✓ Sì, esito identico</span>
                      ) : (
                        <span className="badge badge-ko">✗ No, esito diverso</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {outcome.error && (
                <Alert tone="error" title="Impossibile ricalcolare l’esito">
                  {outcome.error}
                </Alert>
              )}
              {outcome.result && (
                <>
                  <h3 className="panel-subtitle">Esito ricalcolato</h3>
                  <ResultView result={outcome.result} />
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
