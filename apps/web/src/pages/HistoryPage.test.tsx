import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { GameId } from '@casino/engine';
import type { HistoryItem } from '@casino/shared';
import { ME, errorResponse, jsonResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { HistoryPage } from './HistoryPage.tsx';

function item(id: number, game: GameId, summary: string): HistoryItem {
  return {
    id: String(id),
    game,
    status: 'settled',
    stake: 100,
    payout: 0,
    net: -100,
    createdAt: '2026-09-25T10:00:00.000Z',
    settledAt: '2026-09-25T10:00:00.000Z',
    nonce: id,
    summary,
  };
}

function mockHistory() {
  return mockFetch(({ url }) => {
    if (url === '/api/auth/me') return jsonResponse(ME);
    if (url === '/api/history?game=slot&limit=25') {
      return jsonResponse({ items: [item(30, 'slot', 'Slot recente')], nextCursor: '30' });
    }
    if (url === '/api/history?game=slot&cursor=30&limit=25') {
      return jsonResponse({ items: [item(5, 'slot', 'Slot vecchia')], nextCursor: null });
    }
    if (url === '/api/history?limit=25') {
      return jsonResponse({ items: [item(33, 'roulette', 'Uscito 17 nero')], nextCursor: '33' });
    }
    return errorResponse(404, 'NOT_FOUND');
  });
}

function PageWithNav() {
  return (
    <>
      <Link to="/storico">Storico</Link>
      <HistoryPage />
    </>
  );
}

describe('HistoryPage', () => {
  it('starts again from the newest rounds when the filter changes by navigation', async () => {
    const { calls } = mockHistory();
    const user = userEvent.setup({ delay: null });
    renderRoute(<PageWithNav />, { path: '/storico', url: '/storico?game=slot' });

    expect(await screen.findByText('Slot recente')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Meno recenti/ }));
    expect(await screen.findByText('Slot vecchia')).toBeInTheDocument();
    expect(screen.getByText('Pagina 2')).toBeInTheDocument();

    // The nav link drops the filter: page 1 of all games, no stale cursor.
    await user.click(screen.getByRole('link', { name: 'Storico' }));
    expect(await screen.findByText('Uscito 17 nero')).toBeInTheDocument();
    expect(screen.getByText('Pagina 1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Gioco' })).toHaveValue('');
    expect(calls.some((c) => c.url.includes('cursor') && !c.url.includes('game=slot'))).toBe(false);
  });

  it('downloads the CSV of the selected game only', async () => {
    mockHistory();
    const user = userEvent.setup({ delay: null });
    renderRoute(<HistoryPage />, { path: '/storico', url: '/storico?game=slot' });

    const link = await screen.findByRole('link', { name: /Scarica CSV/ });
    expect(link).toHaveAttribute('href', '/api/history/export.csv?game=slot');
    expect(link).toHaveTextContent('Slot Frutta');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Gioco' }), '');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Scarica CSV/ })).toHaveAttribute(
        'href',
        '/api/history/export.csv',
      ),
    );
  });
});
