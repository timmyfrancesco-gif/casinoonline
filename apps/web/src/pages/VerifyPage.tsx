import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  BLACKJACK_ACTIONS,
  CLIENT_SEED_PATTERN,
  GAME_IDS,
  GAME_NAMES_IT,
  IllegalBlackjackActionError,
  IllegalVideoPokerActionError,
  SERVER_SEED_PATTERN,
  UNITS_PER_CHIP,
  VIDEO_POKER_HAND_NAMES_IT,
  hashServerSeed,
  validateRouletteBet,
  verifyRound,
  type BlackjackAction,
  type GameId,
  type RouletteBet,
  type VerifyInput,
  type VerifyResult,
} from '@casino/engine';
import { ROULETTE_MAX_BETS, type RoundDetailResponse } from '@casino/shared';
import { useMe, useRoundDetail } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { Field } from '../components/Field.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { ACTION_LABELS, OUTCOME_SHORT } from '../games/blackjack/labels.ts';
import { COLOR_NAMES_IT, betLabel, numberColor, targetOf } from '../games/roulette/betBuilder.ts';
import { SYMBOL_NAMES_IT, WIN_NAMES_IT } from '../games/slot/symbols.tsx';
import { getCommitment } from '../lib/commitments.ts';
import { chipsLabel, formatDateTimeLong } from '../lib/format.ts';
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

/** Where the expected hash comes from: only a copy kept before the reveal proves the commitment. */
export type HashOrigin =
  { kind: 'local'; recordedAt: string } | { kind: 'server' } | { kind: 'user' };

export interface ExpectedHash {
  hash: string;
  origin: HashOrigin;
  /** The hash recorded by this browser differs from the one the server sends now. */
  conflict: { recorded: string; recordedAt: string; server: string } | null;
}

/** Prefers the hash this browser recorded for the pair over the one the server sends now. */
export function expectedHashFor(seedPairId: string | null, serverHash: string): ExpectedHash {
  const local = seedPairId ? getCommitment(seedPairId) : null;
  if (!local) return { hash: serverHash, origin: { kind: 'server' }, conflict: null };
  return {
    hash: local.hash,
    origin: { kind: 'local', recordedAt: local.firstSeenAt },
    conflict:
      local.hash === serverHash.trim().toLowerCase()
        ? null
        : { recorded: local.hash, recordedAt: local.firstSeenAt, server: serverHash },
  };
}

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

/** A validated bet reduced to its known fields (numbers sorted), in a fixed key order. */
function canonicalBet(bet: RouletteBet): RouletteBet {
  if ('numbers' in bet) {
    return { type: bet.type, numbers: [...bet.numbers].sort((a, b) => a - b), amount: bet.amount };
  }
  if ('index' in bet) return { type: bet.type, index: bet.index, amount: bet.amount };
  return { type: bet.type, amount: bet.amount };
}

/** Comparable form of the player's inputs (the server's JSON may order keys differently). */
export function canonicalInput(input: VerifyInput): string {
  switch (input.game) {
    case 'roulette':
      return JSON.stringify({ game: input.game, bets: input.bets.map(canonicalBet) });
    case 'slot':
      return JSON.stringify({ game: input.game, bet: input.bet });
    case 'blackjack':
      return JSON.stringify({ game: input.game, bet: input.bet, actions: input.actions });
    case 'videopoker':
      return JSON.stringify({ game: input.game, bet: input.bet, held: input.held.map(Boolean) });
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
      if (parsed.length > ROULETTE_MAX_BETS) {
        return { error: `Al massimo ${ROULETTE_MAX_BETS} puntate per giro.` };
      }
      const bets: RouletteBet[] = [];
      for (const [i, raw] of parsed.entries()) {
        const problem = validateRouletteBet(raw as RouletteBet);
        if (problem) return { error: `Puntata ${i + 1}: ${problem}` };
        bets.push(canonicalBet(raw as RouletteBet));
      }
      return { input: { game: 'roulette', bets } };
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

/** True when the form holds the recorded round's own inputs (else no comparison applies). */
export function sameInputsAsRecorded(
  data: RoundDetailResponse,
  clientSeed: string,
  nonce: number,
  input: VerifyInput,
): boolean {
  const f = data.round.fairness;
  return (
    data.verifyInput !== null &&
    f.clientSeed === clientSeed &&
    f.nonce === nonce &&
    canonicalInput(input) === canonicalInput(data.verifyInput)
  );
}

/**
 * Compares the recomputed outcome with what the server recorded: the round's details and the
 * stake and payout actually booked (round.stake / round.payout).
 */
export function matchesRecorded(result: VerifyResult, data: RoundDetailResponse): boolean {
  const d = data.detail;
  const { stake, payout } = data.round;
  switch (result.game) {
    case 'roulette': {
      const s = result.settlement;
      return (
        d.game === 'roulette' &&
        d.settlement.number === s.number &&
        d.settlement.totalWin === s.totalWin &&
        d.settlement.totalBet === s.totalBet &&
        d.settlement.bets.map((b) => b.win).join() === s.bets.map((b) => b.win).join() &&
        s.totalBet === stake &&
        s.totalWin === payout
      );
    }
    case 'slot': {
      const s = result.settlement;
      return (
        d.game === 'slot' &&
        d.settlement.stops.join() === s.stops.join() &&
        d.settlement.win === s.win &&
        s.bet === stake &&
        s.win === payout
      );
    }
    case 'blackjack':
      return (
        d.game === 'blackjack' &&
        (result.state.result?.totalBet ?? -1) === stake &&
        (result.state.result?.totalPayout ?? -1) === payout &&
        d.state.dealer.cards.join() === result.state.dealer.join() &&
        d.state.hands.map((h) => h.cards.join()).join('|') ===
          result.state.hands.map((h) => h.cards.join()).join('|')
      );
    case 'videopoker':
      return (
        d.game === 'videopoker' &&
        d.state.hand.join() === result.state.hand.join() &&
        result.state.bet === stake &&
        (result.state.result?.payout ?? -1) === payout
      );
  }
}

const RECOMPUTE_ERROR = 'I dati inseriti non sono validi per questo gioco.';

/** Italian text for an engine failure: its own message only for the known game rules. */
function recomputeError(err: unknown): string {
  return err instanceof IllegalBlackjackActionError || err instanceof IllegalVideoPokerActionError
    ? `${RECOMPUTE_ERROR} ${err.message}`
    : RECOMPUTE_ERROR;
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
  hashOrigin: HashOrigin['kind'];
  result: VerifyResult | null;
  error: string | null;
  /** Comparison with the recorded round; 'modified' when the inputs are not the recorded ones. */
  recorded: 'match' | 'mismatch' | 'modified' | null;
}

function HashMatchBadge({ outcome }: { outcome: Outcome }) {
  if (outcome.hashMatches === null) return <>Impronta non indicata</>;
  if (!outcome.hashMatches) {
    return <span className="badge badge-ko">✗ No, il seed non corrisponde</span>;
  }
  switch (outcome.hashOrigin) {
    case 'local':
      return <span className="badge badge-ok">✓ Sì, il seed è quello promesso</span>;
    case 'user':
      return <span className="badge badge-ok">✓ Sì, corrisponde all’impronta inserita</span>;
    case 'server':
      return (
        <>
          <span className="badge badge-ok">✓ Corrisponde all’impronta indicata ora dal server</span>{' '}
          <span className="small muted">
            (non registrata prima di giocare: vale come prova solo se l’avevi annotata tu)
          </span>
        </>
      );
  }
}

export function VerifyPage() {
  usePageTitle('Verifica');
  const [params] = useSearchParams();
  const roundId = params.get('round') ?? undefined;
  const { data: me } = useMe();
  const detail = useRoundDetail(me ? roundId : undefined);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [hashOrigin, setHashOrigin] = useState<HashOrigin>({ kind: 'user' });
  const [hashConflict, setHashConflict] = useState<ExpectedHash['conflict']>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const prefilledFor = useRef<string | null>(null);

  // Prefill from a revealed seed pair (links from the profile).
  useEffect(() => {
    const serverSeed = params.get('serverSeed');
    const clientSeed = params.get('clientSeed');
    if (!serverSeed && !clientSeed) return;
    const serverHash = params.get('hash');
    const expected = serverHash ? expectedHashFor(params.get('pair'), serverHash) : null;
    if (expected) {
      setHashOrigin(expected.origin);
      setHashConflict(expected.conflict);
    }
    setForm((f) => ({
      ...f,
      serverSeed: serverSeed ?? f.serverSeed,
      clientSeed: clientSeed ?? f.clientSeed,
      expectedHash: expected?.hash ?? f.expectedHash,
      nonce: params.get('nonce') ?? f.nonce,
    }));
  }, [params]);

  useEffect(() => {
    if (!detail.data || prefilledFor.current === detail.data.round.id) return;
    prefilledFor.current = detail.data.round.id;
    const f = detail.data.round.fairness;
    const expected = expectedHashFor(f.seedPairId, f.serverSeedHash);
    setHashOrigin(expected.origin);
    setHashConflict(expected.conflict);
    setForm({ ...formFromRound(detail.data), expectedHash: expected.hash });
    setOutcome(null);
  }, [detail.data]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // A result on screen must always describe the data in the form.
    setOutcome(null);
    if (key === 'expectedHash') setHashOrigin({ kind: 'user' });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setOutcome(null);
    const serverSeed = form.serverSeed.trim();
    const clientSeed = form.clientSeed.trim();
    const nonceText = form.nonce.trim();
    const nonce = Number(nonceText);
    if (!serverSeed)
      return setFormError('Inserisci il seed del server (rivelato dopo la rotazione).');
    if (!clientSeed) return setFormError('Inserisci il seed client.');
    if (nonceText === '' || !Number.isSafeInteger(nonce) || nonce < 0) {
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
      error = recomputeError(err);
    }
    const recorded =
      detail.data && detail.data.round.id === prefilledFor.current ? detail.data : null;
    setOutcome({
      hash,
      hashMatches: expected ? hash === expected : null,
      hashOrigin: hashOrigin.kind,
      result,
      error,
      recorded:
        result && recorded?.verifyInput
          ? sameInputsAsRecorded(recorded, clientSeed, nonce, built.input)
            ? matchesRecorded(result, recorded)
              ? 'match'
              : 'mismatch'
            : 'modified'
          : null,
    });
  };

  const hashHint =
    hashOrigin.kind === 'local'
      ? `Registrata da questo browser il ${formatDateTimeLong(hashOrigin.recordedAt)}, prima che il seed fosse rivelato.`
      : hashOrigin.kind === 'server'
        ? 'Fornita ora dal server insieme al seed: non registrata da questo browser prima di giocare.'
        : 'Facoltativa: se la inserisci controlliamo che il seed rivelato corrisponda.';

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
      <p className="muted">
        Il seed server di ogni nuova coppia è fissato prima che tu scelga il seed client: nel{' '}
        <Link to="/profilo#seed">profilo</Link> trovi l’«Hash del prossimo seed server», che alla
        rotazione diventa l’impronta della coppia attiva. Così il server non può scegliere il
        proprio seed in base al tuo. Se ruoti i seed da questo browser, quell’hash viene registrato
        e usato qui come impronta attesa.
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
      {hashConflict && (
        <Alert tone="error" title="✗ Impronta diversa da quella registrata">
          Il {formatDateTimeLong(hashConflict.recordedAt)} questo browser ha registrato per questa
          coppia di seed l’impronta <span className="mono break">{hashConflict.recorded}</span>, ma
          ora il server indica <span className="mono break">{hashConflict.server}</span>. Il seed
          del server potrebbe essere stato sostituito: la verifica usa l’impronta registrata.
        </Alert>
      )}
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
            hint={hashHint}
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
                    <HashMatchBadge outcome={outcome} />
                  </dd>
                </div>
                {outcome.recorded !== null && (
                  <div>
                    <dt>Coincide con l’esito registrato?</dt>
                    <dd>
                      {outcome.recorded === 'match' ? (
                        <span className="badge badge-ok">✓ Sì, esito identico</span>
                      ) : outcome.recorded === 'mismatch' ? (
                        <span className="badge badge-ko">✗ No, esito diverso</span>
                      ) : (
                        'Dati modificati: confronto con la partita registrata non applicabile.'
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
