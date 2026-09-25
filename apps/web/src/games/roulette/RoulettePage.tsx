import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ROULETTE_PAYOUTS, UNITS_PER_CHIP, type RouletteInsideType } from '@casino/engine';
import { ROULETTE_MAX_BETS, TABLE_LIMITS, type RouletteSpinResponse } from '@casino/shared';
import { spinRoulette } from '../../api/games.ts';
import { errorMessage } from '../../api/errors.ts';
import {
  queryKeys,
  retryOnNetworkError,
  useBalance,
  useInvalidateAfterRound,
  useSelfExclusionUntil,
  useSetBalance,
} from '../../api/hooks.ts';
import { newIdempotencyKey } from '../../api/idempotency.ts';
import { Alert } from '../../components/Alert.tsx';
import { ChipSelector } from '../../components/Chip.tsx';
import { GameHeader } from '../../components/GameHeader.tsx';
import { chipsLabel } from '../../lib/format.ts';
import { useReducedMotion } from '../../lib/motion.ts';
import { usePageTitle } from '../../lib/usePageTitle.ts';
import {
  COLOR_NAMES_IT,
  INSIDE_TYPE_NAMES_IT,
  PICK_HINTS,
  aggregateBets,
  betKey,
  betLabel,
  numberColor,
  pickNumber,
  placeChip,
  targetOf,
  totalStake,
  type BetTarget,
  type Placement,
} from './betBuilder.ts';
import { RouletteTable } from './RouletteTable.tsx';
import { RouletteWheel } from './RouletteWheel.tsx';

const LIMITS = TABLE_LIMITS.roulette;
const RECENT_MAX = 20;

type Mode = 'table' | Exclude<RouletteInsideType, 'straight'>;
const MODES: { id: Mode; label: string }[] = [
  { id: 'table', label: 'Pieno / tappeto' },
  { id: 'split', label: INSIDE_TYPE_NAMES_IT.split },
  { id: 'street', label: INSIDE_TYPE_NAMES_IT.street },
  { id: 'corner', label: INSIDE_TYPE_NAMES_IT.corner },
  { id: 'sixline', label: INSIDE_TYPE_NAMES_IT.sixline },
  { id: 'trio', label: INSIDE_TYPE_NAMES_IT.trio },
  { id: 'basket', label: INSIDE_TYPE_NAMES_IT.basket },
];

function useRecentNumbers() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.rouletteRecent,
    queryFn: () => [] as number[],
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const push = useCallback(
    (n: number) =>
      client.setQueryData<number[]>(queryKeys.rouletteRecent, (old) =>
        [n, ...(old ?? [])].slice(0, RECENT_MAX),
      ),
    [client],
  );
  return [data ?? [], push] as const;
}

export function RoulettePage() {
  usePageTitle('Roulette europea');
  const balance = useBalance();
  const setBalance = useSetBalance();
  const invalidate = useInvalidateAfterRound();
  const excludedUntil = useSelfExclusionUntil();
  const [recent, pushRecent] = useRecentNumbers();

  const [chip, setChip] = useState(1);
  const [mode, setMode] = useState<Mode>('table');
  const [picked, setPicked] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<number[][]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [lastPlacements, setLastPlacements] = useState<Placement[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [spin, setSpin] = useState<{ id: number; response: RouletteSpinResponse } | null>(null);
  const [revealed, setRevealed] = useState(true);
  const pendingBalance = useRef<number | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const mutation = useMutation({
    mutationFn: spinRoulette,
    retry: retryOnNetworkError,
  });

  // Leaving mid-animation: show the final balance anyway.
  useEffect(
    () => () => {
      if (pendingBalance.current !== null) setBalance(pendingBalance.current);
    },
    [setBalance],
  );

  const bets = useMemo(() => aggregateBets(placements), [placements]);
  const stakes = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bets) map.set(betKey(targetOf(b)), b.amount);
    return map;
  }, [bets]);
  const total = totalStake(bets);
  const busy = mutation.isPending || !revealed;
  const blocked = Boolean(excludedUntil);

  const rules = {
    maxPerBet: LIMITS.maxPerBet,
    maxPerRound: LIMITS.maxPerRound,
    maxBets: ROULETTE_MAX_BETS,
    balance,
  };

  const addChip = (target: BetTarget) => {
    if (busy) return;
    const result = placeChip(placements, target, chip * UNITS_PER_CHIP, rules);
    if (!result.ok) {
      setNotice(result.reason);
      setAnnouncement(result.reason);
      return;
    }
    setNotice(null);
    setPlacements(result.placements);
    const newTotal = totalStake(aggregateBets(result.placements));
    setAnnouncement(
      `${chipsLabel(chip * UNITS_PER_CHIP)} su ${betLabel(target)}. Totale puntato ${chipsLabel(newTotal)}.`,
    );
  };

  const onNumber = (n: number) => {
    if (mode === 'table') {
      addChip({ type: 'straight', numbers: [n] });
      return;
    }
    const result = pickNumber(mode, picked, n);
    if (result.status === 'complete') {
      setPicked([]);
      setCandidates([]);
      addChip(result.target);
    } else if (result.status === 'partial') {
      setPicked(result.selected);
      setCandidates(result.candidates);
      setAnnouncement(
        `Selezionato ${result.selected.join(', ')}. ${result.candidates.length} combinazioni possibili: tocca un altro numero.`,
      );
    } else {
      setPicked([]);
      setCandidates([]);
      const msg = `Il numero ${n} non fa parte di nessuna puntata ${INSIDE_TYPE_NAMES_IT[mode]}.`;
      setNotice(msg);
      setAnnouncement(msg);
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setPicked([]);
    setCandidates([]);
    setNotice(null);
  };

  const undo = () => {
    setPlacements((p) => p.slice(0, -1));
    setNotice(null);
    setAnnouncement('Ultima fiche rimossa.');
  };
  const clear = () => {
    setPlacements([]);
    setNotice(null);
    setAnnouncement('Tutte le puntate rimosse.');
  };
  const removeBet = (key: string) => {
    setPlacements((p) => p.filter((x) => betKey(x.target) !== key));
    setAnnouncement('Puntata rimossa.');
  };
  const repeat = () => {
    let next: Placement[] = [];
    for (const p of lastPlacements) {
      const r = placeChip(next, p.target, p.amount, rules);
      if (!r.ok) {
        setNotice(`Impossibile ripetere tutte le puntate: ${r.reason}`);
        break;
      }
      next = r.placements;
    }
    setPlacements(next);
  };

  const onSpin = () => {
    if (bets.length === 0 || busy || blocked) return;
    setNotice(null);
    const request = { bets, idempotencyKey: newIdempotencyKey() };
    mutation.mutate(request, {
      onSuccess: (response) => {
        // Stake is taken now; winnings are credited when the ball stops.
        pendingBalance.current = response.balance;
        setBalance(response.balance - response.settlement.totalWin);
        setLastPlacements(placements);
        setPlacements([]);
        setPicked([]);
        setCandidates([]);
        setRevealed(false);
        setAnnouncement('La ruota gira…');
        setSpin((prev) => ({ id: (prev?.id ?? 0) + 1, response }));
        // Keep the wheel in sight while it spins (the table may be scrolled below it).
        wheelRef.current?.scrollIntoView?.({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
      },
      onError: (err) => {
        const msg = errorMessage(err);
        setNotice(msg);
        setAnnouncement(msg);
      },
    });
  };

  const onSettled = useCallback(() => {
    if (!spin) return;
    const { settlement, balance: finalBalance } = spin.response;
    pendingBalance.current = null;
    setBalance(finalBalance);
    setRevealed(true);
    pushRecent(settlement.number);
    invalidate();
    const color = COLOR_NAMES_IT[numberColor(settlement.number)];
    const outcome =
      settlement.totalWin > 0
        ? `Rientrano ${chipsLabel(settlement.totalWin)} su ${chipsLabel(settlement.totalBet)} puntate.`
        : `Nessuna vincita: puntate ${chipsLabel(settlement.totalBet)}.`;
    setAnnouncement(`È uscito il ${settlement.number} ${color}. ${outcome}`);
  }, [spin, setBalance, pushRecent, invalidate]);

  const highlighted = useMemo(() => new Set(candidates.flat()), [candidates]);
  const selected = useMemo(() => new Set(picked), [picked]);
  const settlement = revealed && spin ? spin.response.settlement : null;
  const net = settlement ? settlement.totalWin - settlement.totalBet : 0;

  return (
    <div className="page game-page roulette-page">
      <GameHeader game="roulette" />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className="roulette-top" ref={wheelRef}>
        <RouletteWheel
          number={spin ? spin.response.settlement.number : null}
          spinId={spin?.id ?? 0}
          onSettled={onSettled}
        />
        <section className="panel result-panel" aria-labelledby="roulette-result-title">
          <h2 id="roulette-result-title" className="panel-title">
            Risultato
          </h2>
          {!spin && <p className="muted">Piazza le fiches sul tappeto e gira la ruota.</p>}
          {spin && !revealed && <p className="muted">La pallina sta girando…</p>}
          {settlement && (
            <div className={`outcome ${net > 0 ? 'outcome-win' : 'outcome-neutral'}`}>
              <p className="outcome-headline">
                È uscito il <strong>{settlement.number}</strong>{' '}
                {COLOR_NAMES_IT[numberColor(settlement.number)]}
              </p>
              <p>
                Puntato {chipsLabel(settlement.totalBet)} · Rientrano{' '}
                {chipsLabel(settlement.totalWin)}
              </p>
              <p className="outcome-net">
                {net > 0
                  ? `Vincita netta: +${chipsLabel(net)}`
                  : net === 0
                    ? 'In pari: la puntata è tornata indietro.'
                    : `Risultato netto: −${chipsLabel(-net)}`}
              </p>
            </div>
          )}
          <h3 className="panel-subtitle">Ultimi numeri</h3>
          {recent.length === 0 ? (
            <p className="muted small">Nessun numero in questa sessione.</p>
          ) : (
            <ol className="recent-numbers" aria-label="Ultimi numeri usciti, dal più recente">
              {recent.map((n, i) => {
                const c = numberColor(n);
                return (
                  <li key={`${i}-${n}`} className={`recent-number rt-${c}`}>
                    <span>{n}</span>
                    <span className="visually-hidden"> {COLOR_NAMES_IT[c]}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="roulette-bet-title">
        <h2 id="roulette-bet-title" className="panel-title">
          Puntate
        </h2>
        <div className="roulette-controls">
          <ChipSelector
            value={chip}
            onChange={setChip}
            max={LIMITS.maxPerBet / UNITS_PER_CHIP}
            disabled={busy}
          />
          <fieldset className="mode-selector" disabled={busy}>
            <legend>Tipo di puntata</legend>
            <div className="segmented">
              {MODES.map((m) => (
                <label key={m.id} className="segmented-option">
                  <input
                    type="radio"
                    name="roulette-mode"
                    value={m.id}
                    checked={mode === m.id}
                    onChange={() => changeMode(m.id)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
            <p className="field-hint">
              {mode === 'table'
                ? 'Tocca un numero per il pieno, oppure i bordi e gli angoli tra i numeri per cavalli, terzine, carré e sestine.'
                : `${PICK_HINTS[mode]} Pagamento ${ROULETTE_PAYOUTS[mode]}:1.`}
              {picked.length > 0 && ` Selezionati: ${picked.join(', ')}.`}
            </p>
          </fieldset>
        </div>

        <div className="roulette-table-wrap">
          <RouletteTable
            stakes={stakes}
            onNumber={onNumber}
            onTarget={addChip}
            disabled={busy || blocked}
            highlighted={highlighted}
            selected={selected}
            winning={settlement ? settlement.number : null}
            showHotspots={mode === 'table'}
          />
          <p className="legend small muted">
            R = rosso, N = nero. Colonne «2:1», dozzine e puntate semplici pagano come da{' '}
            <Link to="/regole#roulette">regole</Link>.
          </p>
        </div>

        {notice && <Alert tone="warning">{notice}</Alert>}

        <div className="bet-summary">
          <p className="bet-total">
            Totale: <strong>{chipsLabel(total)}</strong>{' '}
            <span className="muted">
              (massimo {chipsLabel(LIMITS.maxPerRound)} per giro, {chipsLabel(LIMITS.maxPerBet)} per
              puntata)
            </span>
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              onClick={undo}
              disabled={busy || placements.length === 0}
            >
              Annulla ultima
            </button>
            <button
              type="button"
              className="btn"
              onClick={clear}
              disabled={busy || placements.length === 0}
            >
              Cancella tutto
            </button>
            <button
              type="button"
              className="btn"
              onClick={repeat}
              disabled={busy || placements.length > 0 || lastPlacements.length === 0}
            >
              Ripeti puntate
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onSpin}
              disabled={busy || blocked || bets.length === 0}
            >
              {mutation.isPending ? 'Invio…' : !revealed ? 'La ruota gira…' : 'Gira la ruota'}
            </button>
          </div>
        </div>

        {bets.length > 0 && (
          <div className="table-scroll">
            <table className="data-table bets-table">
              <caption className="visually-hidden">Puntate sul tappeto</caption>
              <thead>
                <tr>
                  <th scope="col">Puntata</th>
                  <th scope="col" className="num">
                    Fiches
                  </th>
                  <th scope="col" className="num">
                    Paga
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bets.map((bet) => {
                  const key = betKey(targetOf(bet));
                  return (
                    <tr key={key}>
                      <td>{betLabel(targetOf(bet))}</td>
                      <td className="num">{bet.amount / UNITS_PER_CHIP}</td>
                      <td className="num">{ROULETTE_PAYOUTS[bet.type]}:1</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          onClick={() => removeBet(key)}
                          disabled={busy}
                          aria-label={`Rimuovi ${betLabel(targetOf(bet))}`}
                        >
                          Rimuovi
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {settlement && (
        <section className="panel" aria-labelledby="roulette-detail-title">
          <h2 id="roulette-detail-title" className="panel-title">
            Esito per puntata
          </h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Puntata</th>
                  <th scope="col" className="num">
                    Puntato
                  </th>
                  <th scope="col" className="num">
                    Rientro
                  </th>
                  <th scope="col">Esito</th>
                </tr>
              </thead>
              <tbody>
                {settlement.bets.map((r, i) => (
                  <tr key={i} className={r.win > 0 ? 'row-win' : ''}>
                    <td>{betLabel(targetOf(r.bet))}</td>
                    <td className="num">{chipsLabel(r.bet.amount)}</td>
                    <td className="num">{chipsLabel(r.win)}</td>
                    <td>{r.win > 0 ? 'Vinta' : 'Persa'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
