import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { isApiError } from '../api/client.ts';
import { GENERIC_ERROR_MESSAGE, errorMessage } from '../api/errors.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

const CHUNK_LOAD_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/** A lazy page whose chunk could not be loaded (typically right after a redeploy). */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR.test(error.message);
}

/** Error boundary for the router: pages render it inside the layout, the layout at the root. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (isChunkLoadError(error)) {
    return (
      <div className="page page-narrow">
        <h1>Pagina non caricata</h1>
        <p>
          È disponibile una nuova versione del sito, oppure la connessione si è interrotta: ricarica
          la pagina.
        </p>
        <p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Ricarica la pagina
          </button>
        </p>
      </div>
    );
  }
  return (
    <div className="page page-narrow">
      <h1>Qualcosa è andato storto</h1>
      <p>{isApiError(error) ? errorMessage(error) : GENERIC_ERROR_MESSAGE}</p>
      <p>
        <Link to="/" className="btn btn-primary" reloadDocument>
          Ricarica la lobby
        </Link>
      </p>
    </div>
  );
}
