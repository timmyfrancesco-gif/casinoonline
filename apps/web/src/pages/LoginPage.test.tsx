import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '@casino/shared';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderApp } from '../test/utils.tsx';
import { safeRedirect } from './LoginPage.tsx';

describe('LoginPage', () => {
  it('shows the Italian message for wrong credentials, then logs in and goes back', async () => {
    let attempts = 0;
    const { calls } = mockFetch(({ url, method }) => {
      if (url === '/api/auth/me') return errorResponse(401, 'UNAUTHENTICATED');
      if (url === '/api/auth/login' && method === 'POST') {
        attempts += 1;
        return attempts === 1
          ? errorResponse(401, 'INVALID_CREDENTIALS', 'Credenziali non valide')
          : jsonResponse(ME);
      }
      if (url === '/api/rg') return jsonResponse(RG);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderApp('/accedi');

    expect(await screen.findByRole('heading', { name: 'Accedi', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome utente'), 'mario');
    await user.type(screen.getByLabelText('Password'), 'sbagliata123');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nome utente o password non corretti.',
    );
    const login = calls.find((c) => c.url === '/api/auth/login')!;
    expect(login.body).toEqual({ username: 'mario', password: 'sbagliata123' });
    expect(login.headers[CSRF_HEADER]).toBe('1');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'giusta12345');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByRole('heading', { name: /Bentornato, mario/ })).toBeInTheDocument();
    // Balance in the header (100.000 units = 1.000 chips).
    expect(screen.getByText('1.000', { selector: '.balance-value' })).toBeInTheDocument();
  });

  it('redirects anonymous visitors from a table to the login page', async () => {
    mockFetch(({ url }) =>
      url === '/api/auth/me'
        ? errorResponse(401, 'UNAUTHENTICATED')
        : errorResponse(404, 'NOT_FOUND'),
    );
    const { router } = renderApp('/roulette');
    expect(await screen.findByRole('heading', { name: 'Accedi', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/accedi'));
    expect(router.state.location.state).toEqual({ from: '/roulette' });
  });

  it('only accepts same-app redirect targets', () => {
    expect(safeRedirect('/blackjack')).toBe('/blackjack');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
  });
});
