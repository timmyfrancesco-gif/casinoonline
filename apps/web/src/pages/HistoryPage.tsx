import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { GAME_IDS, GAME_NAMES_IT, type GameId } from '@casino/engine';
import { HISTORY_CSV_URL } from '../api/history.ts';
import { useHistory } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { NetAmount } from '../components/Amount.tsx';
import { PageLoader, Spinner } from '../components/Spinner.tsx';
import { chipsLabel, formatDateTime } from '../lib/format.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

const PAGE_SIZE = 25;

function parseGame(value: string | null): GameId | undefined {
  return GAME_IDS.find((g) => g === value);
}

export function HistoryPage() {
  usePageTitle('Storico');
  const [params, setParams] = useSearchParams();
  const game = parseGame(params.get('game'));
  const navigate = useNavigate();
  // Cursor stack: [undefined] is the first page.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useHistory(game, cursor, PAGE_SIZE);

  const setGame = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('game', value);
    else next.delete('game');
    setParams(next, { replace: true });
    setCursors([undefined]);
  };

  const page = query.data;
  const pageNumber = cursors.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Storico delle partite</h1>
          <p className="muted">
            Tutte le partite giocate, con risultato netto e dati per la verifica.
          </p>
        </div>
        <a className="btn" href={HISTORY_CSV_URL} download>
          Scarica CSV
        </a>
      </div>

      <div className="toolbar">
        <div className="field field-inline">
          <label htmlFor="history-game">Gioco</label>
          <select id="history-game" value={game ?? ''} onChange={(e) => setGame(e.target.value)}>
            <option value="">Tutti i giochi</option>
            {GAME_IDS.map((g) => (
              <option key={g} value={g}>
                {GAME_NAMES_IT[g]}
              </option>
            ))}
          </select>
        </div>
        {query.isFetching && !query.isPending && <Spinner inline label="Aggiornamento…" />}
      </div>

      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <Alert tone="error">{errorMessage(query.error)}</Alert>
      ) : page && page.items.length === 0 ? (
        <div className="empty-state">
          <p>
            {game ? 'Nessuna partita per questo gioco.' : 'Non hai ancora giocato nessuna partita.'}
          </p>
          <Link to="/" className="btn btn-primary">
            Vai ai tavoli
          </Link>
        </div>
      ) : page ? (
        <>
          <div className="table-scroll">
            <table className="data-table history-table">
              <caption className="visually-hidden">
                Partite, pagina {pageNumber}. Seleziona una riga per il dettaglio.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Gioco</th>
                  <th scope="col">Esito</th>
                  <th scope="col" className="num">
                    Puntata
                  </th>
                  <th scope="col" className="num">
                    Rientro
                  </th>
                  <th scope="col" className="num">
                    Netto
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Dettaglio</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr
                    key={item.id}
                    className="clickable-row"
                    onClick={() => void navigate(`/storico/${item.id}`)}
                  >
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{GAME_NAMES_IT[item.game]}</td>
                    <td>
                      {item.summary}
                      {item.status === 'open' && <span className="tag">in corso</span>}
                    </td>
                    <td className="num">{chipsLabel(item.stake)}</td>
                    <td className="num">{chipsLabel(item.payout)}</td>
                    <td className="num">
                      <NetAmount value={item.net} suffix={false} />
                    </td>
                    <td>
                      <Link
                        to={`/storico/${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Dettaglio della partita del ${formatDateTime(item.createdAt)}`}
                      >
                        Dettaglio
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="Pagine dello storico">
            <button
              type="button"
              className="btn"
              disabled={cursors.length <= 1}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              ← Più recenti
            </button>
            <span className="muted">Pagina {pageNumber}</span>
            <button
              type="button"
              className="btn"
              disabled={!page.nextCursor || query.isPlaceholderData}
              onClick={() =>
                page.nextCursor && setCursors((c) => [...c, page.nextCursor ?? undefined])
              }
            >
              Meno recenti →
            </button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
