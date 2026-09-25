import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  POKER_HAND_RANKS,
  VIDEO_POKER_HAND_NAMES_IT,
  VIDEO_POKER_PAYTABLE,
  type PokerHandRank,
} from '@casino/engine';
import { TABLE_LIMITS, type VideoPokerRoundResponse } from '@casino/shared';
import { videoPokerDeal, videoPokerDraw, videoPokerOpen } from '../../api/games.ts';
import { isApiError } from '../../api/client.ts';
import { betErrorMessage, errorMessage } from '../../api/errors.ts';
import {
  queryKeys,
  retryOnNetworkError,
  useBalance,
  useInvalidateAfterRound,
  useSelfExclusionUntil,
  useSetBalance,
} from '../../api/hooks.ts';
import { useBetIdempotencyKey } from '../../api/idempotency.ts';
import { Alert } from '../../components/Alert.tsx';
import { GameHeader } from '../../components/GameHeader.tsx';
import { PlayingCard, cardName } from '../../components/PlayingCard.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { StakeSelector } from '../../components/StakeSelector.tsx';
import { chipsLabel } from '../../lib/format.ts';
import { shouldIgnoreShortcut } from '../../lib/keyboard.ts';
import { usePageTitle } from '../../lib/usePageTitle.ts';
import { analyseHolds, type HoldOption } from './holdAnalysis.ts';

const LIMITS = TABLE_LIMITS.videopoker;
const PAYING_RANKS = POKER_HAND_RANKS.filter((r) => r !== 'NOTHING');
const NO_HOLDS = [false, false, false, false, false];

/** CONFLICT (stale step) and ROUND_NOT_OPEN (already settled) carry the current round. */
function conflictRound(err: unknown): VideoPokerRoundResponse | null {
  if (!isApiError(err) || (err.code !== 'CONFLICT' && err.code !== 'ROUND_NOT_OPEN')) return null;
  const round = (err.details as { round?: VideoPokerRoundResponse } | null | undefined)?.round;
  return round && typeof round === 'object' && round.state && round.round ? round : null;
}

function describeHold(held: boolean[]): string {
  const positions = held.map((h, i) => (h ? i + 1 : null)).filter((x) => x !== null);
  if (positions.length === 0) return 'cambia tutte le carte';
  if (positions.length === 5) return 'tieni tutte le carte';
  return `tieni le carte ${positions.join(', ')}`;
}

type HintState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; best: HoldOption; forStep: string }
  | { status: 'error' };

export function VideoPokerPage() {
  usePageTitle('Video Poker');
  const balance = useBalance();
  const setBalance = useSetBalance();
  const invalidate = useInvalidateAfterRound();
  const excludedUntil = useSelfExclusionUntil();
  const [stake, setStake] = useState(LIMITS.min);
  const [round, setRound] = useState<VideoPokerRoundResponse | null>(null);
  const [held, setHeld] = useState<boolean[]>(NO_HOLDS);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hint, setHint] = useState<HintState>({ status: 'idle' });
  const [announcement, setAnnouncement] = useState('');
  const adopted = useRef(false);
  const dealKey = useBetIdempotencyKey();
  // Synchronous double-click guard: `busy` only changes on the next render.
  const dealInFlight = useRef(false);
  const controlsRef = useRef<HTMLElement>(null);
  const dealButtonRef = useRef<HTMLButtonElement>(null);
  const drawButtonRef = useRef<HTMLButtonElement>(null);
  // Move focus to the next control once the hand changes (the pressed button is disabled or gone).
  const refocus = useRef(false);

  const open = useQuery({
    queryKey: queryKeys.open('videopoker'),
    queryFn: videoPokerOpen,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (adopted.current || !open.data) return;
    adopted.current = true;
    if (open.data.round) {
      setRound(open.data.round);
      setInfo('Hai una mano in corso: scegli le carte da tenere e cambia le altre.');
    }
  }, [open.data]);

  // Cached data side of a round answer: balance, plus history and statistics once settled. Kept
  // apart from the table state because it must also run when the answer arrives after the
  // player left the page.
  const syncRound = useCallback(
    (res: VideoPokerRoundResponse) => {
      setBalance(res.balance);
      if (res.state.phase === 'settled') invalidate();
    },
    [setBalance, invalidate],
  );

  // useMutation-level callbacks run even after unmount (the per-call ones of mutate() do not).
  const deal = useMutation({
    mutationFn: videoPokerDeal,
    retry: retryOnNetworkError,
    onSuccess: (res) => {
      dealKey.settle();
      syncRound(res);
    },
    onError: (err) => dealKey.settle(err),
    onSettled: () => {
      dealInFlight.current = false;
    },
  });
  const draw = useMutation({ mutationFn: videoPokerDraw, onSuccess: syncRound });

  const busy = deal.isPending || draw.isPending;
  const state = round?.state ?? null;
  const holding = state?.phase === 'hold';
  const blocked = Boolean(excludedUntil);
  const roundKey = round ? `${round.round.id}:${round.state.step}` : '';

  const applyRound = useCallback((res: VideoPokerRoundResponse) => {
    setRound(res);
    setHint({ status: 'idle' });
    const cards = res.state.hand.map(cardName).join(', ');
    if (res.state.phase === 'hold') {
      setHeld(res.state.held ?? NO_HOLDS);
      setAnnouncement(
        `Carte: ${cards}. Hai: ${VIDEO_POKER_HAND_NAMES_IT[res.state.currentRank]}. Scegli le carte da tenere con i tasti da 1 a 5.`,
      );
    } else {
      const r = res.state.result;
      setAnnouncement(
        `Mano finale: ${cards}. ${r ? `${VIDEO_POKER_HAND_NAMES_IT[r.rank]}: rientrano ${chipsLabel(r.payout)}.` : ''}`,
      );
    }
  }, []);

  const markRefocus = () => {
    const active = document.activeElement;
    refocus.current =
      !active || active === document.body || Boolean(controlsRef.current?.contains(active));
  };

  const onDeal = () => {
    if (dealInFlight.current || busy || holding || blocked || open.isPending) return;
    dealInFlight.current = true;
    markRefocus();
    setError(null);
    setInfo(null);
    deal.mutate(
      // Same stake after an uncertain failure = same key: the server never deals it twice.
      { amount: stake, idempotencyKey: dealKey.keyFor(String(stake)) },
      {
        onSuccess: applyRound,
        onError: (err) => {
          if (isApiError(err) && err.code === 'ROUND_ALREADY_OPEN') {
            void open.refetch().then(({ data }) => {
              if (data?.round) {
                syncRound(data.round);
                applyRound(data.round);
              }
            });
          }
          setError(betErrorMessage(err));
        },
      },
    );
  };

  const onDraw = useCallback(() => {
    if (!round || busy || round.state.phase !== 'hold') return;
    markRefocus();
    setError(null);
    setInfo(null);
    draw.mutate(
      { roundId: round.round.id, held, step: round.state.step },
      {
        onSuccess: applyRound,
        onError: (err) => {
          const current = conflictRound(err);
          if (current) {
            syncRound(current);
            applyRound(current);
            setInfo(
              current.state.phase === 'settled'
                ? 'La mano era già conclusa (forse in un’altra scheda): ecco l’esito.'
                : 'La mano era già avanzata (forse da un’altra scheda): stato aggiornato.',
            );
            return;
          }
          if (isApiError(err) && err.code === 'ROUND_NOT_OPEN') {
            void open.refetch().then(({ data }) => setRound(data?.round ?? null));
          }
          setError(errorMessage(err));
        },
      },
    );
  }, [round, busy, draw, held, syncRound, applyRound, open]);

  // Keyboard users keep their place: after the deal focus goes to «Cambia», after the draw to the
  // deal button (only when focus was lost with the pressed button: never steal it).
  const phase = round?.state.phase;
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && active !== document.body && active.disabled !== true) return;
    const target = phase === 'hold' ? drawButtonRef.current : dealButtonRef.current;
    if (target && !target.disabled) target.focus();
  }, [busy, phase]);

  const toggleHold = useCallback(
    (i: number) => {
      if (!holding || busy) return;
      setHeld((prev) => prev.map((h, j) => (j === i ? !h : h)));
    },
    [holding, busy],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= 5) {
        event.preventDefault();
        toggleHold(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleHold]);

  const askHint = () => {
    if (!state || state.phase !== 'hold') return;
    const forStep = roundKey;
    setHint({ status: 'loading' });
    analyseHolds(state.hand).then(
      (options) => {
        const best = options[0];
        setHint(best ? { status: 'ready', best, forStep } : { status: 'error' });
      },
      () => setHint({ status: 'error' }),
    );
  };

  const result = state?.phase === 'settled' ? state.result : null;
  const highlightRank: PokerHandRank | null = result
    ? result.rank
    : state && state.phase === 'hold'
      ? state.currentRank
      : null;
  const net = result && state ? result.payout - state.bet : 0;
  const bet = state?.bet ?? stake;

  return (
    <div className="page game-page videopoker-page">
      <GameHeader game="videopoker" />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className="vp-layout">
        <section className="panel paytable-panel" aria-labelledby="vp-paytable-title">
          <h2 id="vp-paytable-title" className="panel-title">
            Tabella dei pagamenti 9/6
          </h2>
          <table className="data-table paytable">
            <caption className="small muted">
              Rientro per {chipsLabel(bet)} puntate (puntata inclusa).
            </caption>
            <thead>
              <tr>
                <th scope="col">Mano</th>
                <th scope="col" className="num">
                  ×
                </th>
                <th scope="col" className="num">
                  Rientro
                </th>
              </tr>
            </thead>
            <tbody>
              {PAYING_RANKS.map((rank) => (
                <tr
                  key={rank}
                  className={
                    highlightRank === rank
                      ? // Jacks or Better returns the stake (net 0): no win highlight.
                        result && net > 0
                        ? 'row-win'
                        : 'row-current'
                      : ''
                  }
                  aria-current={highlightRank === rank ? 'true' : undefined}
                >
                  <th scope="row">{VIDEO_POKER_HAND_NAMES_IT[rank]}</th>
                  <td className="num">{VIDEO_POKER_PAYTABLE[rank]}</td>
                  <td className="num">{chipsLabel(bet * VIDEO_POKER_PAYTABLE[rank])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Ritorno teorico 99,54% solo con strategia perfetta. Un mazzo da 52 carte rimescolato a
            ogni mano.
          </p>
        </section>

        <section className="felt vp-table" aria-labelledby="vp-table-title">
          <h2 id="vp-table-title" className="visually-hidden">
            Carte
          </h2>
          {open.isPending && <Spinner label="Controllo delle mani in corso…" />}
          {state ? (
            <>
              <div className="vp-cards" role="group" aria-label="Le tue carte">
                {state.hand.map((code, i) => {
                  const isHeld = holding ? held[i] === true : state.held?.[i] === true;
                  const replaced = !holding && state.dealt[i] !== code;
                  return (
                    <div key={`${i}-${code}`} className="vp-card-slot">
                      {holding ? (
                        <button
                          type="button"
                          className={`vp-card-button ${isHeld ? 'is-held' : ''}`}
                          aria-pressed={isHeld}
                          onClick={() => toggleHold(i)}
                          disabled={busy}
                          aria-keyshortcuts={String(i + 1)}
                          aria-label={`Carta ${i + 1}: ${cardName(code)}${isHeld ? ', tenuta' : ''}`}
                        >
                          <PlayingCard code={code} size="lg" index={i} />
                        </button>
                      ) : (
                        <PlayingCard
                          code={code}
                          size="lg"
                          index={i}
                          className={replaced ? 'is-new' : ''}
                        />
                      )}
                      <span className={`hold-label ${isHeld ? 'is-held' : ''}`} aria-hidden="true">
                        {isHeld ? 'TENUTA' : holding ? `Tasto ${i + 1}` : replaced ? 'nuova' : ' '}
                      </span>
                    </div>
                  );
                })}
              </div>
              {holding && (
                <p className="vp-current">
                  Hai: <strong>{VIDEO_POKER_HAND_NAMES_IT[state.currentRank]}</strong>. Tocca le
                  carte (o premi 1-5) per tenerle, poi cambia le altre.
                </p>
              )}
            </>
          ) : (
            !open.isPending &&
            !open.isError && (
              <p className="bj-empty">
                {blocked
                  ? 'Tavolo non disponibile durante la pausa di autoesclusione.'
                  : 'Scegli la puntata e premi «Distribuisci» per ricevere 5 carte.'}
              </p>
            )
          )}
        </section>
      </div>

      {open.isError && (
        <Alert tone="error" title="Impossibile controllare se hai una mano in corso">
          <p>{errorMessage(open.error)}</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void open.refetch()}
            disabled={open.isFetching}
          >
            Riprova
          </button>
        </Alert>
      )}
      {info && <Alert tone="info">{info}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {result && state && (
        <div className={`outcome ${net > 0 ? 'outcome-win' : 'outcome-neutral'}`}>
          <p className="outcome-headline">{VIDEO_POKER_HAND_NAMES_IT[result.rank]}</p>
          <p>
            Puntato {chipsLabel(state.bet)} · Rientrano {chipsLabel(result.payout)} ·{' '}
            {net > 0
              ? `netto +${chipsLabel(net)}`
              : net === 0
                ? 'in pari'
                : `netto −${chipsLabel(-net)}`}
          </p>
        </div>
      )}

      <section className="panel" aria-label="Comandi" ref={controlsRef}>
        {holding && state ? (
          // Keyed rows: React must not turn the focused deal button into «Suggerimento».
          <div className="vp-actions" key="hold">
            <button
              ref={drawButtonRef}
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onDraw}
              disabled={busy}
            >
              {draw.isPending ? 'Cambio…' : `Cambia ${held.filter((h) => !h).length} carte`}
            </button>
            <button
              type="button"
              className="btn"
              onClick={askHint}
              disabled={busy || hint.status === 'loading'}
            >
              Suggerimento
            </button>
            {hint.status === 'loading' && <Spinner inline label="Calcolo del suggerimento…" />}
            {hint.status === 'ready' && hint.forStep === roundKey && (
              <div className="hint" role="status">
                <p>
                  Scelta migliore: {describeHold(hint.best.held)} (valore atteso{' '}
                  {hint.best.ev.toLocaleString('it-IT', { maximumFractionDigits: 3 })} volte la
                  puntata).
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setHeld(hint.best.held)}
                >
                  Applica il suggerimento
                </button>
              </div>
            )}
            {hint.status === 'error' && (
              <p className="hint" role="status">
                Suggerimento non disponibile in questo momento.
              </p>
            )}
          </div>
        ) : (
          <div className="deal-row" key="deal">
            <StakeSelector
              value={stake}
              onChange={setStake}
              limits={LIMITS}
              balance={balance}
              disabled={busy || open.isPending}
              presets={[1, 2, 5, 10, 25, 50]}
            />
            <button
              ref={dealButtonRef}
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onDeal}
              disabled={busy || blocked || open.isPending || (balance !== null && stake > balance)}
            >
              {deal.isPending ? 'Distribuzione…' : `Distribuisci (${chipsLabel(stake)})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
