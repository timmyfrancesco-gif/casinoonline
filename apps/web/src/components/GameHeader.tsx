import { Link } from 'react-router';
import type { GameId } from '@casino/engine';
import { GAMES } from '../games/gameInfo.ts';
import { chipsLabel, formatDateTimeLong } from '../lib/format.ts';
import { useSelfExclusionUntil } from '../api/hooks.ts';
import { Alert } from './Alert.tsx';

/** Title, RTP / house edge and table limits shown on every table. */
export function GameHeader({ game }: { game: GameId }) {
  const info = GAMES[game];
  const excludedUntil = useSelfExclusionUntil();
  return (
    <header className="game-header">
      <div className="game-header-title">
        <h1>{info.name}</h1>
        <p className="game-tagline">{info.tagline}</p>
      </div>
      <dl className="game-facts">
        <div>
          <dt>RTP</dt>
          <dd>{info.rtpLabel}</dd>
        </div>
        <div>
          <dt>Vantaggio del banco</dt>
          <dd>{info.houseEdgeLabel}</dd>
        </div>
        <div>
          <dt>Limiti</dt>
          <dd>
            {chipsLabel(info.limits.min)} – {chipsLabel(info.limits.maxPerBet)}
          </dd>
        </div>
        <div className="game-facts-link">
          <Link to={`/regole#${game}`}>Regole e probabilità</Link>
        </div>
      </dl>
      {excludedUntil && (
        <Alert tone="warning" title="Pausa di autoesclusione attiva">
          Fino al {formatDateTimeLong(excludedUntil)} non puoi iniziare nuove partite. Puoi
          consultare storico e statistiche. Se ti serve aiuto, trovi i contatti nella pagina{' '}
          <Link to="/gioco-responsabile">Gioco responsabile</Link>.
        </Alert>
      )}
    </header>
  );
}
