import { useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { STARTING_BALANCE, formatChips } from '@casino/engine';
import {
  MIN_AGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  VIRTUAL_CHIPS_DISCLAIMER,
} from '@casino/shared';
import { useMe, useRegister } from '../api/hooks.ts';
import { errorCode, errorMessage } from '../api/errors.ts';
import { Alert } from '../components/Alert.tsx';
import { Field } from '../components/Field.tsx';
import { usePageTitle } from '../lib/usePageTitle.ts';

/** Age in whole years on `today` for a YYYY-MM-DD birth date (null when invalid). */
export function ageOn(birthDate: string, today: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  let age = today.getFullYear() - y;
  const month = today.getMonth() + 1;
  if (month < m || (month === m && today.getDate() < d)) age -= 1;
  return age;
}

function isoDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Errors = Partial<Record<'username' | 'password' | 'confirm' | 'birthDate' | 'terms', string>>;

export function RegisterPage() {
  usePageTitle('Registrati');
  const { data: me } = useMe();
  const registerMutation = useRegister();
  const navigate = useNavigate();
  const termsId = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  if (me && !registerMutation.isPending && !registerMutation.isSuccess) {
    return <Navigate to="/" replace />;
  }

  const maxBirth = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - MIN_AGE);
    return isoDate(d);
  })();

  const validate = (): Errors => {
    const next: Errors = {};
    if (!USERNAME_PATTERN.test(username)) {
      next.username = 'Da 3 a 20 caratteri: lettere, numeri e trattino basso (_).';
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      next.password = `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`;
    } else if (password.length > PASSWORD_MAX_LENGTH) {
      next.password = `La password può avere al massimo ${PASSWORD_MAX_LENGTH} caratteri.`;
    }
    if (confirm !== password) next.confirm = 'Le due password non coincidono.';
    const age = ageOn(birthDate);
    if (age === null) next.birthDate = 'Inserisci una data di nascita valida.';
    else if (age < MIN_AGE) next.birthDate = `Per registrarti devi avere almeno ${MIN_AGE} anni.`;
    if (!terms) next.terms = 'Per continuare devi accettare le condizioni.';
    return next;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first invalid field once the error state has rendered.
      const form = event.currentTarget;
      window.setTimeout(() => {
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    registerMutation.mutate(
      { username, password, birthDate, acceptTerms: true },
      {
        onSuccess: () => void navigate('/', { replace: true }),
        onError: (err) => {
          const code = errorCode(err);
          if (code === 'USERNAME_TAKEN') setErrors({ username: errorMessage(err) });
          if (code === 'UNDERAGE') setErrors({ birthDate: errorMessage(err) });
        },
      },
    );
  };

  const serverCode = registerMutation.isError ? errorCode(registerMutation.error) : null;
  const serverError =
    registerMutation.isError && serverCode !== 'USERNAME_TAKEN' && serverCode !== 'UNDERAGE'
      ? errorMessage(registerMutation.error)
      : null;
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="page page-narrow">
      <div className="form-card">
        <h1>Registrati</h1>
        <p className="muted">
          Ricevi {formatChips(STARTING_BALANCE)} fiches virtuali per giocare. Chiediamo solo un nome
          utente e una password.
        </p>
        {serverError && <Alert tone="error">{serverError}</Alert>}
        {hasErrors && !serverError && <Alert tone="error">Controlla i campi evidenziati.</Alert>}
        <form onSubmit={onSubmit} noValidate className="form">
          <Field
            label="Nome utente"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            hint="Da 3 a 20 caratteri tra lettere, numeri e _. È visibile solo a te."
            error={errors.username}
            required
          />
          <Field
            label="Password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={PASSWORD_MAX_LENGTH}
            hint={`Almeno ${PASSWORD_MIN_LENGTH} caratteri. Usa una password che non usi altrove.`}
            error={errors.password}
            required
          />
          <Field
            label="Conferma password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={PASSWORD_MAX_LENGTH}
            error={errors.confirm}
            required
          />
          <Field
            label="Data di nascita"
            name="birth-date"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            max={maxBirth}
            min="1900-01-01"
            hint="Serve solo a verificare la maggiore età e non viene salvata."
            error={errors.birthDate}
            required
          />
          <div className={`field field-check ${errors.terms ? 'field-invalid' : ''}`}>
            <input
              id={termsId}
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? `${termsId}-error` : undefined}
            />
            <label htmlFor={termsId}>
              Ho almeno {MIN_AGE} anni e accetto le condizioni: {VIRTUAL_CHIPS_DISCLAIMER} Ho letto
              le <Link to="/regole">regole</Link> e le informazioni sul{' '}
              <Link to="/gioco-responsabile">gioco responsabile</Link>.
            </label>
            {errors.terms && (
              <p id={`${termsId}-error`} className="field-error">
                {errors.terms}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? 'Registrazione in corso…' : 'Crea account'}
          </button>
        </form>
        <p className="form-footer">
          Hai già un account? <Link to="/accedi">Accedi</Link>
        </p>
      </div>
    </div>
  );
}
