import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RgStatus } from '@casino/shared';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { ResponsibleGamingPage } from './ResponsibleGamingPage.tsx';

describe('ResponsibleGamingPage', () => {
  it('always shows the helpline, even to anonymous visitors', async () => {
    mockFetch(() => errorResponse(401, 'UNAUTHENTICATED'));
    renderRoute(<ResponsibleGamingPage />);
    expect(await screen.findByRole('link', { name: '800 558 822' })).toHaveAttribute(
      'href',
      'tel:800558822',
    );
    expect(await screen.findByRole('link', { name: 'Accedi' })).toBeInTheDocument();
  });

  it('sets a loss limit and keeps the confirmation visible after the refresh', async () => {
    let rg: RgStatus = RG;
    const { calls } = mockFetch(({ url, method, body }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(rg);
      if (url === '/api/rg/loss-limit' && method === 'PUT') {
        const value = (body as { value: number }).value;
        rg = {
          ...RG,
          lossLimits: {
            ...RG.lossLimits,
            '24h': { value, pending: null, used: 0, remaining: value },
          },
        };
        return jsonResponse(rg);
      }
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ResponsibleGamingPage />);

    const inputs = await screen.findAllByLabelText('Nuovo limite (fiches)');
    await user.type(inputs[0]!, '20');
    await user.click(screen.getAllByRole('button', { name: 'Salva' })[0]!);

    expect(await screen.findByText('Limite aggiornato: è già in vigore.')).toBeInTheDocument();
    expect(screen.getByText('In vigore: 20 fiches')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/rg/loss-limit')?.body).toEqual({
      period: '24h',
      value: 2000,
    });
  });

  it('requires a strong confirmation before a self-exclusion', async () => {
    const { calls } = mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      if (url === '/api/rg/self-exclusion') {
        return jsonResponse({ ...RG, selfExclusion: { until: '2099-01-01T00:00:00.000Z' } });
      }
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ResponsibleGamingPage />);
    await user.click(await screen.findByRole('radio', { name: /7 giorni/ }));
    await user.click(screen.getByRole('button', { name: /Prendi una pausa di 7 giorni/ }));

    const confirm = screen.getByRole('button', { name: 'Conferma la pausa' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /non si può annullare/ }));
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/per confermare/), 'pausa');
    await user.click(confirm);

    expect(await screen.findByText(/Pausa attivata/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/rg/self-exclusion')?.body).toEqual({
      duration: '7d',
    });
  });
});
