import { Link } from 'react-router';
import { usePageTitle } from '../lib/usePageTitle.ts';

export function NotFoundPage() {
  usePageTitle('Pagina non trovata');
  return (
    <div className="page page-narrow center-text">
      <p className="big-number" aria-hidden="true">
        404
      </p>
      <h1>Pagina non trovata</h1>
      <p>L’indirizzo che hai aperto non esiste o è stato spostato.</p>
      <p>
        <Link to="/" className="btn btn-primary">
          Torna alla lobby
        </Link>
      </p>
    </div>
  );
}
