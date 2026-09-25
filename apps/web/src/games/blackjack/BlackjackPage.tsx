import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  blackjackBasicStrategy,
  type BlackjackAction,
  type BlackjackPublicHand,
  type BlackjackPublicState,
} from '@casino/engine';
import { TABLE_LIMITS, type BlackjackRoundResponse } from '@casino/shared';
import { blackjackAction, blackjackDeal, blackjackOpen } from '../../api/games.ts';
import { isApiError } from '../../api/client.ts';
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
import { GameHeader } from '../../components/GameHeader.tsx';
import { PlayingCard, cardName } from '../../components/PlayingCard.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { StakeSelector } from '../../components/StakeSelector.tsx';
import { chipsLabel } from '../../lib/format.ts';
import { shouldIgnoreShortcut } from '../../lib/keyboard.ts';
import { usePageTitle } from '../../lib/usePageTitle.ts';
import { ACTION_KEYS, ACTION_LABELS, OUTCOME_LABELS } from './labels.ts';

const LIMITS = TABLE_LIMITS.blackjack;

const KEY_TO_ACTION: Record<string, BlackjackAction> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
};
const ACTION_ORDER: BlackjackAction[] = ['hit', 'stand', 'double', 'split'];

/**
 * A 409 CONFLICT (stale step) or ROUND_NOT_OPEN (already settled) carries the current round in
 * details.round: the client resyncs from it.
 */
export function conflictRound(err: unknown): BlackjackRoundResponse | null {
  if (!isApiError(err) || (err.code !== 'CONFLICT' && err.code !== 'ROUND_NOT_OPEN')) return null;
  const details = err.details as { round?: unknown } | null | undefined;
  const round = details?.round as BlackjackRoundResponse | undefined;
  return round && typeof round === 'object' && round.state && round.round ? round : null;
}

function totalText(total: number, soft: boolean): string {
  return soft && total < 21 ? `${total} (morbido)` : String(total);
}

function safeHint(state: BlackjackPublicState): BlackjackAction | null {
  try {
    return blackjackBasicStrategy(state);
  } catch {
    return null;
  }
}

function HandView({
  hand,
  index,
  active,
  settled,
  count,
}: {
  hand: BlackjackPublicHand;
  index: number;
  active: boolean;
  settled: boolean;
  count: number;
}) {
  const title = count > 1 ? `Mano ${index + 1}` : 'La tua mano';
  const bust = hand.total > 21;
  return (
    <div
      className={`bj-hand ${active && !settled ? 'is-active' : ''} ${hand.result ? `result-${hand.result.outcome}` : ''}`}
      aria-current={active && !settled ? 'true' : undefined}
    >
      <h3 className="bj-hand-title">
        {title}
        {active && !settled && count > 1 && <span className="tag">in gioco</span>}
      </h3>
      <div className="card-row" role="list" aria-label={`Carte di ${title.toLowerCase()}`}>
        {hand.cards.map((c, i) => (
          <div role="listitem" key={i}>
            <PlayingCard code={c} index={i} />
          </div>
        ))}
      </div>
      <p className="bj-total">
        Totale: <strong>{totalText(hand.total, hand.soft)}</strong>
        {bust && <span className="tag tag-danger">sballato</span>}
        {hand.doubled && <span className="tag">raddoppiata</span>}
      </p>
      <p className="small muted">Puntata: {chipsLabel(hand.bet)}</p>
      {hand.result && (
        <p className="bj-hand-result">
          {OUTCOME_LABELS[hand.result.outcome]} · rientrano {chipsLabel(hand.result.payout)}
        </p>
      )}
    </div>
  );
}

export function BlackjackPage() {
  usePageTitle('Blackjack');
  const balance = useBalance();
  const setBalance = useSetBalance();
  const invalidate = useInvalidateAfterRound();
  const excludedUntil = useSelfExclusionUntil();
  const [stake, setStake] = useState(LIMITS.min);
  const [round, setRound] = useState<BlackjackRoundResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const adopted = useRef(false);

  const open = useQuery({
    queryKey: queryKeys.open('blackjack'),
    queryFn: blackjackOpen,
    staleTime: 0,
    gcTime: 0,
  });

  // Resume a hand left open (reload, other tab).
  useEffect(() => {
    if (adopted.current || !open.data) return;
    adopted.current = true;
    if (open.data.round) {
      setRound(open.data.round);
      setInfo('Hai una mano in corso: puoi completarla.');
    }
  }, [open.data]);

  const deal = useMutation({ mutationFn: blackjackDeal, retry: retryOnNetworkError });
  const action = useMutation({ mutationFn: blackjackAction });

  const describe = useCallback((res: BlackjackRoundResponse): string => {
    const s = res.state;
    const dealerVisible = s.dealer.cards
      .filter((c): c is number => c !== null)
      .map(cardName)
      .join(', ');
    if (s.phase === 'settled' && s.result) {
      const net = s.result.totalPayout - s.result.totalBet;
      const hands = s.hands
        .map(
          (h, i) =>
            `${s.hands.length > 1 ? `mano ${i + 1}: ` : ''}${h.result ? OUTCOME_LABELS[h.result.outcome] : ''}`,
        )
        .join('; ');
      return `Mano conclusa. Banco ${s.result.dealerBusted ? 'sballato' : s.result.dealerTotal}. ${hands}. Rientrano ${chipsLabel(s.result.totalPayout)}, netto ${net >= 0 ? '+' : '−'}${chipsLabel(Math.abs(net))}.`;
    }
    const hand = s.hands[s.active];
    const cards = hand ? hand.cards.map(cardName).join(', ') : '';
    return `Le tue carte: ${cards}, totale ${hand ? totalText(hand.total, hand.soft) : ''}. Il banco mostra ${dealerVisible}.`;
  }, []);

  const applyRound = useCallback(
    (res: BlackjackRoundResponse) => {
      setRound(res);
      setBalance(res.balance);
      setAnnouncement(describe(res));
      if (res.state.phase === 'settled') invalidate();
    },
    [setBalance, describe, invalidate],
  );

  const busy = deal.isPending || action.isPending;
  const playing = round?.state.phase === 'player';
  const blocked = Boolean(excludedUntil);

  const onDeal = () => {
    if (busy || playing || blocked || !open.data) return;
    setError(null);
    setInfo(null);
    deal.mutate(
      { amount: stake, idempotencyKey: newIdempotencyKey() },
      {
        onSuccess: applyRound,
        onError: (err) => {
          if (isApiError(err) && err.code === 'ROUND_ALREADY_OPEN') {
            void open.refetch().then(({ data }) => {
              if (data?.round) setRound(data.round);
            });
          }
          setError(errorMessage(err));
        },
      },
    );
  };

  const onAction = useCallback(
    (act: BlackjackAction) => {
      if (!round || busy || round.state.phase !== 'player') return;
      if (!round.state.allowedActions.includes(act)) return;
      setError(null);
      setInfo(null);
      action.mutate(
        { roundId: round.round.id, action: act, step: round.state.step },
        {
          onSuccess: applyRound,
          onError: (err) => {
            const current = conflictRound(err);
            if (current) {
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
    },
    [round, busy, action, applyRound, open],
  );

  // Keyboard shortcuts H / S / D / P.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      const act = KEY_TO_ACTION[event.key.toLowerCase()];
      if (!act) return;
      event.preventDefault();
      onAction(act);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);

  const state = round?.state ?? null;
  const hint = showHint && state && state.phase === 'player' ? safeHint(state) : null;
  const activeHand = state ? state.hands[state.active] : undefined;
  const result = state?.phase === 'settled' ? state.result : null;
  const net = result ? result.totalPayout - result.totalBet : 0;

  const extraCost = (act: BlackjackAction): number => {
    if (!state || !activeHand) return 0;
    return act === 'double' || act === 'split' ? activeHand.bet : 0;
  };

  return (
    <div className="page game-page blackjack-page">
      <GameHeader game="blackjack" />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <section className="felt bj-table" aria-labelledby="bj-table-title">
        <h2 id="bj-table-title" className="visually-hidden">
          Tavolo
        </h2>
        {open.isPending && <Spinner label="Controllo delle mani in corso…" />}
        {state ? (
          <>
            <div className="bj-dealer">
              <h3 className="bj-hand-title">Banco</h3>
              <div className="card-row" role="list" aria-label="Carte del banco">
                {state.dealer.cards.map((c, i) => (
                  <div role="listitem" key={i}>
                    <PlayingCard code={c} index={i} />
                  </div>
                ))}
              </div>
              <p className="bj-total">
                Totale: <strong>{totalText(state.dealer.total, state.dealer.soft)}</strong>
                {state.dealer.cards.includes(null) && (
                  <span className="muted"> + carta coperta</span>
                )}
                {result?.dealerBlackjack && <span className="tag">blackjack</span>}
                {result?.dealerBusted && <span className="tag tag-danger">sballato</span>}
              </p>
            </div>
            <p className="bj-rules-line" aria-hidden="true">
              Il banco sta su tutti i 17 · Blackjack paga 3:2
            </p>
            <div className="bj-hands">
              {state.hands.map((hand, i) => (
                <HandView
                  key={i}
                  hand={hand}
                  index={i}
                  active={i === state.active}
                  settled={state.phase === 'settled'}
                  count={state.hands.length}
                />
              ))}
            </div>
          </>
        ) : (
          !open.isPending && (
            <p className="bj-empty">
              {blocked
                ? 'Tavolo non disponibile durante la pausa di autoesclusione.'
                : 'Scegli la puntata e premi «Distribuisci» per iniziare una mano.'}
            </p>
          )
        )}
      </section>

      {info && <Alert tone="info">{info}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {result && (
        <div className={`outcome ${net > 0 ? 'outcome-win' : 'outcome-neutral'}`}>
          <p className="outcome-headline">
            {net > 0
              ? 'Mano vinta'
              : net === 0
                ? 'Pareggio'
                : result.totalPayout > 0
                  ? 'Mano chiusa'
                  : 'Mano persa'}
          </p>
          <p>
            Puntato {chipsLabel(result.totalBet)} · Rientrano {chipsLabel(result.totalPayout)} ·
            Netto {net >= 0 ? '+' : '−'}
            {chipsLabel(Math.abs(net))}
          </p>
        </div>
      )}

      <section className="panel bj-controls" aria-label="Comandi">
        {playing && state ? (
          <>
            <div className="action-row" role="group" aria-label="Mosse disponibili">
              {ACTION_ORDER.map((act) => {
                const allowed = state.allowedActions.includes(act);
                if (!allowed) return null;
                const cost = extraCost(act);
                const noFunds = cost > 0 && balance !== null && cost > balance;
                const excludedExtra = cost > 0 && blocked;
                return (
                  <button
                    key={act}
                    type="button"
                    className={`btn btn-lg btn-action ${hint === act ? 'is-hinted' : ''}`}
                    onClick={() => onAction(act)}
                    disabled={busy || noFunds || excludedExtra}
                    aria-keyshortcuts={ACTION_KEYS[act]}
                    title={noFunds ? 'Saldo insufficiente' : undefined}
                  >
                    {ACTION_LABELS[act]}
                    {cost > 0 && <span className="btn-sub"> +{chipsLabel(cost)}</span>}
                    <kbd aria-hidden="true">{ACTION_KEYS[act]}</kbd>
                  </button>
                );
              })}
            </div>
            <p className="small muted">
              Scorciatoie da tastiera: H carta, S stai, D raddoppia, P dividi.
            </p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showHint}
                onChange={(e) => setShowHint(e.target.checked)}
              />
              <span>Mostra il suggerimento della strategia di base</span>
            </label>
            {showHint && (
              <p className="hint" role="status">
                {hint
                  ? `Strategia di base: ${ACTION_LABELS[hint]}.`
                  : 'Suggerimento non disponibile per questa mano.'}
              </p>
            )}
          </>
        ) : (
          <div className="deal-row">
            <StakeSelector
              value={stake}
              onChange={setStake}
              limits={LIMITS}
              balance={balance}
              disabled={busy || !open.data}
            />
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onDeal}
              disabled={busy || blocked || !open.data || (balance !== null && stake > balance)}
            >
              {deal.isPending
                ? 'Distribuzione…'
                : round
                  ? `Nuova mano (${chipsLabel(stake)})`
                  : `Distribuisci (${chipsLabel(stake)})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
