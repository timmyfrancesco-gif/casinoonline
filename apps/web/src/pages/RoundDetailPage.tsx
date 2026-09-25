import { Link, useParams } from 'react-router';
import { GAME_NAMES_IT, ROULETTE_PAYOUTS, VIDEO_POKER_HAND_NAMES_IT } from '@casino/engine';
import type { RoundDetailData, RoundDetailResponse } from '@casino/shared';
import { useRoundDetail } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { NetAmount } from '../components/Amount.tsx';
import { PlayingCard } from '../components/PlayingCard.tsx';
import { PageLoader } from '../components/Spinner.tsx';
import { ACTION_LABELS, OUTCOME_SHORT } from '../games/blackjack/labels.ts';
import { COLOR_NAMES_IT, betLabel, numberColor, targetOf } from '../games/roulette/betBuilder.ts';
import { SYMBOL_NAMES_IT, SlotSymbolIcon, WIN_NAMES_IT } from '../games/slot/symbols.tsx';
import { chipsLabel, formatDateTimeLong } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

function DetailBody({ detail }: { detail: RoundDetailData }) {
  switch (detail.game) {
    case 'roulette': {
      const { settlement } = detail;
      const color = numberColor(settlement.number);
      return (
        <>
          <p className="detail-headline">
            Numero uscito: <span className={`number-badge rt-${color}`}>{settlement.number}</span>{' '}
            {COLOR_NAMES_IT[color]}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Puntata</th>
                <th scope="col" className="num">
                  Puntato
                </th>
                <th scope="col" className="num">
                  Paga
                </th>
                <th scope="col" className="num">
                  Rientro
                </th>
              </tr>
            </thead>
            <tbody>
              {settlement.bets.map((r, i) => (
                <tr key={i} className={r.win > 0 ? 'row-win' : ''}>
                  <td>{betLabel(targetOf(r.bet))}</td>
                  <td className="num">{chipsLabel(r.bet.amount)}</td>
                  <td className="num">{ROULETTE_PAYOUTS[r.bet.type]}:1</td>
                  <td className="num">{chipsLabel(r.win)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    }
    case 'slot': {
      const { settlement } = detail;
      return (
        <>
          <div
            className="slot-window"
            role="img"
            aria-label={`Linea: ${settlement.line.map((s) => SYMBOL_NAMES_IT[s]).join(', ')}`}
          >
            {settlement.window.map((row, r) => (
              <div key={r} className={`slot-window-row ${r === 1 ? 'is-payline' : ''}`}>
                {row.map((symbol, c) => (
                  <SlotSymbolIcon key={c} symbol={symbol} className="slot-symbol-small" />
                ))}
              </div>
            ))}
          </div>
          <p>
            Fermate dei rulli: {settlement.stops.join(', ')} ·{' '}
            {settlement.kind
              ? `${WIN_NAMES_IT[settlement.kind]} (×${settlement.multiplier})`
              : 'Nessuna combinazione vincente'}
          </p>
        </>
      );
    }
    case 'blackjack': {
      const { state, actions } = detail;
      return (
        <>
          <h3 className="panel-subtitle">Banco ({state.dealer.total})</h3>
          <div className="card-row">
            {state.dealer.cards.map((c, i) => (
              <PlayingCard key={i} code={c} />
            ))}
          </div>
          {state.hands.map((hand, i) => (
            <div key={i}>
              <h3 className="panel-subtitle">
                {state.hands.length > 1 ? `Mano ${i + 1}` : 'Giocatore'} ({hand.total})
                {hand.result &&
                  ` — ${OUTCOME_SHORT[hand.result.outcome]}, rientro ${chipsLabel(hand.result.payout)}`}
              </h3>
              <div className="card-row">
                {hand.cards.map((c, j) => (
                  <PlayingCard key={j} code={c} />
                ))}
              </div>
            </div>
          ))}
          <p>
            Mosse:{' '}
            {actions.length > 0 ? actions.map((a) => ACTION_LABELS[a]).join(' → ') : 'nessuna'}
          </p>
        </>
      );
    }
    case 'videopoker': {
      const { state } = detail;
      return (
        <>
          <h3 className="panel-subtitle">Carte distribuite</h3>
          <div className="card-row">
            {state.dealt.map((c, i) => (
              <div key={i} className="vp-card-slot">
                <PlayingCard code={c} />
                <span className={`hold-label ${state.held?.[i] ? 'is-held' : ''}`}>
                  {state.held?.[i] ? 'TENUTA' : ' '}
                </span>
              </div>
            ))}
          </div>
          {state.phase === 'settled' && (
            <>
              <h3 className="panel-subtitle">Mano finale</h3>
              <div className="card-row">
                {state.hand.map((c, i) => (
                  <PlayingCard key={i} code={c} />
                ))}
              </div>
            </>
          )}
          <p>
            {state.result
              ? `${VIDEO_POKER_HAND_NAMES_IT[state.result.rank]} (×${state.result.multiplier})`
              : `In corso: ${VIDEO_POKER_HAND_NAMES_IT[state.currentRank]}`}
          </p>
        </>
      );
    }
  }
}

export function FairnessDetails({ data }: { data: RoundDetailResponse }) {
  const f = data.round.fairness;
  return (
    <dl className="kv-list mono-values">
      <div>
        <dt>Impronta del seed server (SHA-256)</dt>
        <dd className="mono">{f.serverSeedHash}</dd>
      </div>
      <div>
        <dt>Seed server</dt>
        <dd className="mono">
          {f.serverSeed ?? (
            <span className="muted">
              Non ancora rivelato: sarà visibile dopo la rotazione dei seed nel{' '}
              <Link to="/profilo#seed">profilo</Link>.
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>Seed client</dt>
        <dd className="mono">{f.clientSeed}</dd>
      </div>
      <div>
        <dt>Nonce</dt>
        <dd className="mono">{f.nonce}</dd>
      </div>
    </dl>
  );
}

export function RoundDetailPage() {
  const { id } = useParams();
  usePageTitle(`Partita ${id ?? ''}`);
  const query = useRoundDetail(id);

  if (query.isPending) return <PageLoader />;
  if (query.isError) {
    return (
      <div className="page page-narrow">
        <Alert tone="error">{errorMessage(query.error)}</Alert>
        <Link to="/storico">← Torna allo storico</Link>
      </div>
    );
  }
  const data = query.data;
  const { round } = data;
  const net = round.status === 'settled' ? round.payout - round.stake : 0;
  const canVerify = Boolean(data.verifyInput && round.fairness.serverSeed);

  return (
    <div className="page">
      <p>
        <Link to="/storico">← Storico</Link>
      </p>
      <div className="page-header">
        <div>
          <h1>
            {GAME_NAMES_IT[round.game]} · partita n. {round.id}
          </h1>
          <p className="muted">
            {formatDateTimeLong(round.createdAt)} ·{' '}
            {round.status === 'open' ? 'in corso' : `chiusa ${formatDateTimeLong(round.settledAt)}`}
          </p>
        </div>
        {canVerify ? (
          <Link to={`/verifica?round=${round.id}`} className="btn btn-primary">
            Verifica
          </Link>
        ) : (
          <button type="button" className="btn" disabled aria-describedby="verify-why">
            Verifica
          </button>
        )}
      </div>
      {!canVerify && (
        <p id="verify-why" className="small muted">
          {round.status === 'open'
            ? 'La partita è ancora in corso.'
            : 'Il seed del server di questa partita non è ancora rivelato: ruota i seed dal profilo per poterla verificare.'}
        </p>
      )}

      <dl className="stat-cards">
        <div className="stat-card">
          <dt>Puntato</dt>
          <dd>{chipsLabel(round.stake)}</dd>
        </div>
        <div className="stat-card">
          <dt>Rientro</dt>
          <dd>{chipsLabel(round.payout)}</dd>
        </div>
        <div className="stat-card">
          <dt>Netto</dt>
          <dd>
            <NetAmount value={net} />
          </dd>
        </div>
      </dl>

      <section className="panel" aria-labelledby="detail-title">
        <h2 id="detail-title" className="panel-title">
          Svolgimento
        </h2>
        <DetailBody detail={data.detail} />
      </section>

      <section className="panel" aria-labelledby="fair-title">
        <h2 id="fair-title" className="panel-title">
          Dati provably fair
        </h2>
        <FairnessDetails data={data} />
      </section>
    </div>
  );
}
