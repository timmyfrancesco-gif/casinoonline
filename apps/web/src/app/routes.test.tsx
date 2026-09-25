import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderApp } from '../test/utils.tsx';

// A lazy page whose chunk is gone (e.g. after a redeploy with new hashed file names): the
// route's lazy() rejects with the browser's TypeError.
vi.mock('../pages/HistoryPage.tsx', () => ({
  get HistoryPage(): never {
    throw new TypeError(
      'Failed to fetch dynamically imported module: http://127.0.0.1/assets/HistoryPage-DeSldYCE.js',
    );
  },
}));

describe('routes', () => {
  it('shows a chunk-load failure in Italian inside the layout, with the virtual-chips banner', async () => {
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      return errorResponse(404, 'NOT_FOUND');
    });
    renderApp('/storico');

    expect(await screen.findByRole('heading', { name: 'Pagina non caricata' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ricarica la pagina' })).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported module/)).not.toBeInTheDocument();
    // Rendered inside the layout: header navigation and the permanent disclaimer are there.
    expect(screen.getByText('Solo fiches virtuali.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Principale' })).toBeInTheDocument();
  });
});
