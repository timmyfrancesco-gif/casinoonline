import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  SLOT_PAYTABLE,
  type SlotSettlement,
  type SlotStops,
  type SlotWinKind,
} from '@casino/engine';
import { TABLE_LIMITS, type SlotSpinResponse } from '@casino/shared';
import { spinSlot } from '../../api/games.ts';
import { betErrorMessage } from '../../api/errors.ts';
import {
  retryOnNetworkError,
  useBalance,
  useInvalidateAfterRound,
  useSelfExclusionUntil,
  useSetBalance,
} from '../../api/hooks.ts';
import { useBetIdempotencyKey } from '../../api/idempotency.ts';
import { Alert } from '../../components/Alert.tsx';
import { GameHeader } from '../../components/GameHeader.tsx';
import { StakeSelector } from '../../components/StakeSelector.tsx';
import { chipsLabel, formatPercent } from '../../lib/format.ts';
import { usePageTitle } from '../../lib/usePageTitle.ts';
import { SLOT_COMBINATIONS, SLOT_HIT_COMBINATIONS, SLOT_TOTAL_RETURN } from '../gameInfo.ts';
import { Reel } from './Reel.tsx';
import { SYMBOL_NAMES_IT, SlotSymbolIcon, WIN_NAMES_IT, WIN_SYMBOLS } from './symbols.tsx';

const LIMITS = TABLE_LIMITS.slot;
const REEL_DURATIONS = [900, 1250, 1600];
const INITIAL_STOPS: SlotStops = [0, 6, 13];
const PAY_ORDER: SlotWinKind[] = [
  'THREE_SEVEN',
  'THREE_BAR',
  'THREE_BELL',
  'THREE_CHERRY',
  'THREE_LEMON',
  'THREE_ORANGE',
  'TWO_CHERRY',
];

export function describeLine(settlement: SlotSettlement): string {
  return settlement.line.map((s) => SYMBOL_NAMES_IT[s]).join(', ');
}

export function SlotPage() {
  usePageTitle('Slot Frutta');
  const balance = useBalance();
  const setBalance = useSetBalance();
  const invalidate = useInvalidateAfterRound();
  const excludedUntil = useSelfExclusionUntil();
  const [stake, setStake] = useState(LIMITS.min);
  const [spin, setSpin] = useState<{ id: number; response: SlotSpinResponse } | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const stoppedReels = useRef(new Set<number>());
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const spinKey = useBetIdempotencyKey();
  // Spin settled by the server but not shown yet (request pending or reels still turning).
  const unrevealed = useRef<SlotSpinResponse | null>(null);
  const mounted = useRef(false);
  // Synchronous double-click guard: `busy` only changes on the next render.
  const inFlight = useRef(false);
  // Give focus back to the spin button after the spin (it is disabled meanwhile).
  const refocus = useRef(false);

  // The spin is over for the player even if they never see it: balance, history, statistics
  // and limits are brought up to date.
  const flushUnrevealed = useCallback(() => {
    const response = unrevealed.current;
    if (!response) return;
    unrevealed.current = null;
    setBalance(response.balance);
    invalidate();
  }, [setBalance, invalidate]);

  const mutation = useMutation({
    mutationFn: spinSlot,
    retry: retryOnNetworkError,
    // These run even after the page unmounted (the per-call callbacks of mutate() do not).
    onSuccess: (response) => {
      unrevealed.current = response;
      spinKey.settle();
      if (!mounted.current) flushUnrevealed();
    },
    onError: (err) => spinKey.settle(err),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  // Leaving while the request is pending or the reels turn: apply the result anyway.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flushUnrevealed();
    };
  }, [flushUnrevealed]);

  const busy = mutation.isPending || !revealed;
  const blocked = Boolean(excludedUntil);
  const stops = spin ? spin.response.settlement.stops : INITIAL_STOPS;
  const settlement = revealed && spin ? spin.response.settlement : null;

  const onSpin = () => {
    if (inFlight.current || busy || blocked) return;
    inFlight.current = true;
    const active = document.activeElement;
    refocus.current = !active || active === document.body || active === spinButtonRef.current;
    setError(null);
    // Same stake after an uncertain failure = same key: the server never takes it twice.
    mutation.mutate(
      { amount: stake, idempotencyKey: spinKey.keyFor(String(stake)) },
      {
        onSuccess: (response) => {
          // Stake is taken now; winnings are credited when the reels stop.
          setBalance(response.balance - response.settlement.win);
          stoppedReels.current = new Set();
          setRevealed(false);
          setAnnouncement('I rulli girano…');
          setSpin((prev) => ({ id: (prev?.id ?? 0) + 1, response }));
        },
        // The error alert (role="alert") announces itself.
        onError: (err) => setError(betErrorMessage(err)),
      },
    );
  };

  const onStopped = useCallback(
    (reel: number) => {
      stoppedReels.current.add(reel);
      if (stoppedReels.current.size < 3 || !spin) return;
      const s = spin.response.settlement;
      if (unrevealed.current === spin.response) flushUnrevealed();
      setRevealed(true);
      const result = s.kind
        ? `${WIN_NAMES_IT[s.kind]}: rientrano ${chipsLabel(s.win)} (puntata ${chipsLabel(s.bet)}).`
        : `Nessuna combinazione vincente. Puntata ${chipsLabel(s.bet)}.`;
      setAnnouncement(`Linea: ${describeLine(s)}. ${result}`);
    },
    [spin, flushUnrevealed],
  );

  // Keyboard users keep their place: once the spin is over (or failed), focus returns to the
  // spin button.
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    // Only when focus was lost (the pressed button was disabled): never steal it.
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && active !== document.body && active.disabled !== true) return;
    const spinButton = spinButtonRef.current;
    if (spinButton && !spinButton.disabled) spinButton.focus();
  }, [busy]);

  const net = settlement ? settlement.win - settlement.bet : 0;

  return (
    <div className="page game-page slot-page">
      <GameHeader game="slot" />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className="slot-layout">
        <section className="panel slot-machine-panel" aria-labelledby="slot-machine-title">
          <h2 id="slot-machine-title" className="visually-hidden">
            Rulli
          </h2>
          <div className="slot-machine">
            <div className="reels">
              {[0, 1, 2].map((i) => (
                <Reel
                  key={i}
                  index={i}
                  stop={stops[i]!}
                  spinId={spin?.id ?? 0}
                  fallback={spin ? spin.response.settlement.window.map((row) => row[i]!) : null}
                  durationMs={REEL_DURATIONS[i]!}
                  onStopped={onStopped}
                  highlight={Boolean(settlement?.kind)}
                />
              ))}
              <div className="payline" aria-hidden="true" />
            </div>
          </div>

          <div className="slot-result">
            {!spin && <p className="muted">Scegli la puntata e premi «Gira».</p>}
            {spin && !revealed && <p className="muted">I rulli girano…</p>}
            {settlement && (
              <div className={`outcome ${net > 0 ? 'outcome-win' : 'outcome-neutral'}`}>
                <p className="outcome-headline">
                  {settlement.kind ? WIN_NAMES_IT[settlement.kind] : 'Nessuna combinazione'}
                </p>
                <p>Linea: {describeLine(settlement)}</p>
                <p className="outcome-net">
                  {settlement.win > 0
                    ? `Rientrano ${chipsLabel(settlement.win)} · netto +${chipsLabel(net)}`
                    : `Puntata persa: −${chipsLabel(settlement.bet)}`}
                </p>
              </div>
            )}
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="slot-controls">
            <StakeSelector
              value={stake}
              onChange={setStake}
              limits={LIMITS}
              balance={balance}
              disabled={busy}
              presets={[1, 2, 5, 10, 25, 50]}
            />
            <button
              ref={spinButtonRef}
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onSpin}
              disabled={busy || blocked || (balance !== null && stake > balance)}
            >
              {mutation.isPending
                ? 'Invio…'
                : !revealed
                  ? 'I rulli girano…'
                  : `Gira (${chipsLabel(stake)})`}
            </button>
          </div>
        </section>

        <section className="panel paytable-panel" aria-labelledby="slot-paytable-title">
          <h2 id="slot-paytable-title" className="panel-title">
            Tabella dei pagamenti
          </h2>
          <div className="table-scroll">
            <table className="data-table paytable">
              <caption className="small muted">
                Valori restituiti per una puntata di {chipsLabel(stake)} (puntata inclusa), solo
                sulla linea centrale.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Combinazione</th>
                  <th scope="col" className="num">
                    Moltiplicatore
                  </th>
                  <th scope="col" className="num">
                    Rientro
                  </th>
                </tr>
              </thead>
              <tbody>
                {PAY_ORDER.map((kind) => (
                  <tr
                    key={kind}
                    className={settlement?.kind === kind ? 'row-win' : ''}
                    aria-current={settlement?.kind === kind ? 'true' : undefined}
                  >
                    <th scope="row">
                      <span className="paytable-name">
                        <span className="paytable-symbols" aria-hidden="true">
                          {WIN_SYMBOLS[kind].map((s, i) => (
                            <SlotSymbolIcon key={i} symbol={s} className="slot-symbol-small" />
                          ))}
                        </span>
                        <span>{WIN_NAMES_IT[kind]}</span>
                      </span>
                    </th>
                    <td className="num">×{SLOT_PAYTABLE[kind]}</td>
                    <td className="num">{chipsLabel(stake * SLOT_PAYTABLE[kind])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="summary-list compact">
            <div>
              <dt>RTP esatto</dt>
              <dd>
                {formatPercent(SLOT_TOTAL_RETURN / SLOT_COMBINATIONS)} ({SLOT_TOTAL_RETURN}/
                {SLOT_COMBINATIONS})
              </dd>
            </div>
            <div>
              <dt>Frequenza di vincita</dt>
              <dd>{formatPercent(SLOT_HIT_COMBINATIONS / SLOT_COMBINATIONS, 3)}</dd>
            </div>
          </dl>
          <p className="small muted">
            Ogni rullo ha 20 posizioni (1 sette, 2 bar, 3 campane, 4 ciliegie, 5 limoni, 5 arance).
            I rulli mostrano sempre le posizioni estratte: nessun «quasi vinto» pilotato.
          </p>
        </section>
      </div>
    </div>
  );
}
