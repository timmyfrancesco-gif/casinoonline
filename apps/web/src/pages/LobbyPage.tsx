import { Link } from 'react-router';
import { STARTING_BALANCE, formatChips } from '@casino/engine';
import { HELPLINE } from '@casino/shared';
import { useMe } from '../api/hooks.ts';
import { GameArt } from '../games/GameArt.tsx';
import { GAME_LIST } from '../games/gameInfo.ts';
import { chipsLabel } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

export function LobbyPage() {
  usePageTitle('Lobby');
  const { data: me } = useMe();

  return (
    <div className="page">
      <section className="hero" aria-labelledby="lobby-title">
        <div className="hero-text">
          <h1 id="lobby-title">
            {me ? `Bentornato, ${me.user.username}` : 'Il casinò a fiches virtuali'}
          </h1>
          <p className="lead">
            Roulette, slot, blackjack e video poker con regole chiare, probabilità dichiarate ed
            esiti verificabili. Nessun denaro reale: ricevi {formatChips(STARTING_BALANCE)} fiches
            virtuali all’iscrizione, che non si comprano e non si convertono.
          </p>
          {!me && (
            <p className="hero-actions">
              <Link to="/registrati" className="btn btn-primary btn-lg">
                Crea un account gratuito
              </Link>
              <Link to="/accedi" className="btn btn-lg">
                Accedi
              </Link>
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="tables-title">
        <h2 id="tables-title" className="section-title">
          Tavoli
        </h2>
        <ul className="game-grid">
          {GAME_LIST.map((game) => (
            <li key={game.id} className="game-card">
              <div className="game-card-art">
                <GameArt game={game.id} />
              </div>
              <div className="game-card-body">
                <h3>{game.name}</h3>
                <p>{game.tagline}</p>
                <dl className="game-card-facts">
                  <div>
                    <dt>RTP</dt>
                    <dd>{game.rtpLabel}</dd>
                  </div>
                  <div>
                    <dt>Vantaggio banco</dt>
                    <dd>{game.houseEdgeLabel}</dd>
                  </div>
                  <div>
                    <dt>Puntata</dt>
                    <dd>
                      {formatChips(game.limits.min)}–{chipsLabel(game.limits.maxPerBet)}
                    </dd>
                  </div>
                </dl>
                <p className="game-card-note">{game.rtpNote}</p>
              </div>
              <div className="game-card-actions">
                <Link
                  to={game.path}
                  className="btn btn-primary"
                  aria-label={`Gioca a ${game.name}`}
                >
                  Gioca
                </Link>
                <Link
                  to={`/regole#${game.id}`}
                  className="btn btn-ghost"
                  aria-label={`Regole di ${game.name}`}
                >
                  Regole
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="info-grid" aria-label="Come funziona">
        <article className="info-card">
          <h2>Probabilità oneste</h2>
          <p>
            Ogni tavolo mostra il ritorno teorico (RTP) e il vantaggio del banco. Nel lungo periodo
            il banco vince sempre: gioca per divertimento.
          </p>
          <Link to="/regole">Regole e probabilità</Link>
        </article>
        <article className="info-card">
          <h2>Esiti verificabili</h2>
          <p>
            Ogni partita deriva da un seed del server (di cui vedi l’impronta prima di giocare), dal
            tuo seed e da un contatore. Dopo la rotazione dei seed puoi ricalcolare ogni esito nel
            browser.
          </p>
          <Link to="/verifica">Verifica una partita</Link>
        </article>
        <article className="info-card">
          <h2>Gioco responsabile</h2>
          <p>
            Limiti di perdita, pausa di autoesclusione e promemoria periodici. Se hai bisogno di
            parlare con qualcuno: {HELPLINE.phone}.
          </p>
          <Link to="/gioco-responsabile">Strumenti e contatti</Link>
        </article>
      </section>
    </div>
  );
}
