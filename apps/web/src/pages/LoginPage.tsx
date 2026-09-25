import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { PASSWORD_MAX_LENGTH } from '@casino/shared';
import { useLogin, useMe } from '../api/hooks.ts';
import { errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { Field } from '../components/Field.tsx';
import type { LoginRedirectState } from '../app/RequireAuth.tsx';
import { usePageTitle } from '../lib/usePageTitle.ts';

/** Only same-app paths are accepted as redirect targets. */
export function safeRedirect(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  usePageTitle('Accedi');
  const { data: me } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeRedirect((location.state as LoginRedirectState | null)?.from);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  if (me && !login.isPending && !login.isSuccess) return <Navigate to={from} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!username.trim() || !password) {
      setFormError('Inserisci nome utente e password.');
      return;
    }
    login.mutate(
      { username: username.trim(), password },
      { onSuccess: () => void navigate(from, { replace: true }) },
    );
  };

  const error = formError ?? (login.isError ? errorMessage(login.error) : null);

  return (
    <div className="page page-narrow">
      <div className="form-card">
        <h1>Accedi</h1>
        <p className="muted">Entra per giocare con le tue fiches virtuali.</p>
        {error && <Alert tone="error">{error}</Alert>}
        <form onSubmit={onSubmit} noValidate className="form">
          <Field
            label="Nome utente"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={64}
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={PASSWORD_MAX_LENGTH}
            required
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={login.isPending}>
            {login.isPending ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>
        <p className="form-footer">
          Non hai un account? <Link to="/registrati">Registrati</Link>
        </p>
      </div>
    </div>
  );
}
