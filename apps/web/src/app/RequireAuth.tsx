import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { PageLoader } from '../components/Spinner.tsx';

export interface LoginRedirectState {
  from?: string;
}

/** Guards tables and private pages: anonymous visitors go to "Accedi" and come back afterwards. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { data: me, isPending, isError, error, refetch } = useMe();
  const location = useLocation();

  if (isPending) return <PageLoader label="Verifica della sessione…" />;
  if (isError) {
    return (
      <div className="page page-narrow">
        <Alert tone="error" title="Impossibile verificare la sessione">
          {errorMessage(error)}
        </Alert>
        <button type="button" className="btn" onClick={() => void refetch()}>
          Riprova
        </button>
      </div>
    );
  }
  if (!me) {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/accedi" replace state={state} />;
  }
  return <>{children ?? <Outlet />}</>;
}
