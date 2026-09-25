import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { errorMessage } from '../api/errors.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

/** Last-resort error boundary for the router. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <div className="page page-narrow">
      <h1>Qualcosa è andato storto</h1>
      <p>{errorMessage(error)}</p>
      <p>
        <Link to="/" className="btn btn-primary" reloadDocument>
          Ricarica la lobby
        </Link>
      </p>
    </div>
  );
}
