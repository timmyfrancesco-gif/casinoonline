import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { RegisterPage, ageOn } from './RegisterPage.tsx';

async function fillForm(user: ReturnType<typeof userEvent.setup>, birthDate = '1990-05-01') {
  await user.type(screen.getByLabelText('Nome utente'), 'giulia_88');
  await user.type(screen.getByLabelText('Password'), 'unapasswordlunga');
  await user.type(screen.getByLabelText('Conferma password'), 'unapasswordlunga');
  await user.type(screen.getByLabelText('Data di nascita'), birthDate);
  await user.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
  it('validates the form on the client before calling the server', async () => {
    const { fn } = mockFetch(() => errorResponse(401, 'UNAUTHENTICATED'));
    const user = userEvent.setup({ delay: null });
    renderRoute(<RegisterPage />, { path: '/registrati' });
    await user.type(screen.getByLabelText('Nome utente'), 'ab');
    await user.type(screen.getByLabelText('Password'), 'corta');
    await user.click(screen.getByRole('button', { name: 'Crea account' }));

    expect(
      await screen.findByText('Da 3 a 20 caratteri: lettere, numeri e trattino basso (_).'),
    ).toBeInTheDocument();
    expect(screen.getByText(/almeno 10 caratteri/)).toBeInTheDocument();
    expect(screen.getByText('Per continuare devi accettare le condizioni.')).toBeInTheDocument();
    expect(fn.mock.calls.filter(([url]) => String(url) === '/api/auth/register')).toHaveLength(0);
  });

  it('shows USERNAME_TAKEN on the username field', async () => {
    const { calls } = mockFetch(({ url }) =>
      url === '/api/auth/register'
        ? errorResponse(409, 'USERNAME_TAKEN', 'Nome utente già usato')
        : errorResponse(401, 'UNAUTHENTICATED'),
    );
    const user = userEvent.setup({ delay: null });
    renderRoute(<RegisterPage />, { path: '/registrati' });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Crea account' }));

    expect(
      await screen.findByText('Questo nome utente è già in uso: scegline un altro.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nome utente')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.find((c) => c.url === '/api/auth/register')?.body).toEqual({
      username: 'giulia_88',
      password: 'unapasswordlunga',
      birthDate: '1990-05-01',
      acceptTerms: true,
    });
  });

  it('shows the server UNDERAGE error in Italian on the birth date', async () => {
    mockFetch(({ url }) =>
      url === '/api/auth/register'
        ? errorResponse(400, 'UNDERAGE', 'Minorenne')
        : errorResponse(401, 'UNAUTHENTICATED'),
    );
    const user = userEvent.setup({ delay: null });
    renderRoute(<RegisterPage />, { path: '/registrati' });
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Crea account' }));
    expect(
      await screen.findByText('Per registrarti devi avere almeno 18 anni.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Data di nascita')).toHaveAttribute('aria-invalid', 'true');
  });

  it('computes the age in whole years', () => {
    const today = new Date(2026, 8, 25);
    expect(ageOn('2008-09-25', today)).toBe(18);
    expect(ageOn('2008-09-26', today)).toBe(17);
    expect(ageOn('2008-02-30', today)).toBeNull();
    expect(ageOn('abc', today)).toBeNull();
  });
});
