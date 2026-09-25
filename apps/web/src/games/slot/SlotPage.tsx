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
import { errorMessage } from '../../api/errors.ts';
import {
  retryOnNetworkError,
  useBalance,
  useInvalidateAfterRound,
  useSelfExclusionUntil,
  useSetBalance,
} from '../../api/hooks.ts';
import { newIdempotencyKey } from '../../api/idempotency.ts';
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
  const pendingBalance = useRef<number | null>(null);

  const mutation = useMutation({ mutationFn: spinSlot, retry: retryOnNetworkError });

  useEffect(
    () => () => {
      if (pendingBalance.current !== null) setBalance(pendingBalance.current);
    },
    [setBalance],
  );

  const busy = mutation.isPending || !revealed;
  const blocked = Boolean(excludedUntil);
  const stops = spin ? spin.response.settlement.stops : INITIAL_STOPS;
  const settlement = revealed && spin ? spin.response.settlement : null;

  const onSpin = () => {
    if (busy || blocked) return;
    setError(null);
    mutation.mutate(
      { amount: stake, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: (response) => {
          pendingBalance.current = response.balance;
          setBalance(response.balance - response.settlement.win);
          stoppedReels.current = new Set();
          setRevealed(false);
          setAnnouncement('I rulli girano…');
          setSpin((prev) => ({ id: (prev?.id ?? 0) + 1, response }));
        },
        onError: (err) => {
          const msg = errorMessage(err);
          setError(msg);
          setAnnouncement(msg);
        },
      },
    );
  };

  const onStopped = useCallback(
    (reel: number) => {
      stoppedReels.current.add(reel);
      if (stoppedReels.current.size < 3 || !spin) return;
      const s = spin.response.settlement;
      pendingBalance.current = null;
      setBalance(spin.response.balance);
      setRevealed(true);
      invalidate();
      const result = s.kind
        ? `${WIN_NAMES_IT[s.kind]}: rientrano ${chipsLabel(s.win)} (puntata ${chipsLabel(s.bet)}).`
        : `Nessuna combinazione vincente. Puntata ${chipsLabel(s.bet)}.`;
      setAnnouncement(`Linea: ${describeLine(s)}. ${result}`);
    },
    [spin, setBalance, invalidate],
  );

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
          <table className="data-table paytable">
            <caption className="small muted">
              Valori restituiti per una puntata di {chipsLabel(stake)} (puntata inclusa), solo sulla
              linea centrale.
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
