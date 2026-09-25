import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { settleSlot, type SlotStops } from '@casino/engine';
import type { MeResponse, SlotSpinResponse } from '@casino/shared';
import { queryKeys } from '../../api/hooks.ts';
import {
  ME,
  RG,
  errorResponse,
  jsonResponse,
  mockFetch,
  renderRoute,
  type RecordedCall,
} from '../../test/utils.tsx';
import { SlotPage } from './SlotPage.tsx';

const STOPS: SlotStops = [0, 6, 13];

function spinResponse(amount: number): SlotSpinResponse {
  const settlement = settleSlot(amount, STOPS);
  return {
    round: {
      id: '9',
      game: 'slot',
      status: 'settled',
      stake: amount,
      payout: settlement.win,
      createdAt: '2026-09-25T10:00:00.000Z',
      settledAt: '2026-09-25T10:00:00.000Z',
      fairness: {
        seedPairId: '1',
        serverSeedHash: 'f'.repeat(64),
        clientSeed: 'c',
        nonce: 0,
        serverSeed: null,
      },
    },
    settlement,
    balance: ME.balance - amount + settlement.win,
  };
}

function spinHandler(before?: () => Promise<void> | void) {
  return async ({ url, body }: RecordedCall) => {
    if (url === '/api/auth/me') return jsonResponse(ME);
    if (url === '/api/rg') return jsonResponse(RG);
    if (url === '/api/games/slot/spin') {
      await before?.();
      return jsonResponse(spinResponse((body as { amount: number }).amount));
    }
    if (url.startsWith('/api/')) return jsonResponse({});
    return errorResponse(404, 'NOT_FOUND');
  };
}

const spinCalls = (calls: RecordedCall[]) => calls.filter((c) => c.url === '/api/games/slot/spin');

describe('SlotPage', () => {
  it('sends one bet for a double click and gives focus back to the spin button', async () => {
    const { calls } = mockFetch(spinHandler());
    const user = userEvent.setup({ delay: null });
    renderRoute(<SlotPage />, { path: '/slot' });
    const spin = await screen.findByRole('button', { name: 'Gira (1 fiche)' });
    spin.focus();
    await user.dblClick(spin);

    expect(await screen.findByText(/^Linea:/, { selector: '.outcome p' })).toBeInTheDocument();
    expect(spinCalls(calls)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Gira (1 fiche)' })).toHaveFocus(),
    );
  });

  it('after an uncertain failure reuses the key for the same stake, announcing the error once', async () => {
    let fail = true;
    const handler = spinHandler();
    const { calls } = mockFetch((call) =>
      call.url === '/api/games/slot/spin' && fail ? errorResponse(503, 'INTERNAL') : handler(call),
    );
    const user = userEvent.setup({ delay: null });
    renderRoute(<SlotPage />, { path: '/slot' });
    await user.click(await screen.findByRole('button', { name: 'Gira (1 fiche)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Esito incerto/);
    expect(screen.getAllByText(/Esito incerto/)).toHaveLength(1);

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Gira (1 fiche)' }));
    expect(await screen.findByText(/^Linea:/, { selector: '.outcome p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gira (1 fiche)' }));
    await waitFor(() => expect(spinCalls(calls)).toHaveLength(3));

    const keys = spinCalls(calls).map((c) => (c.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('applies a spin answered after the player left the table', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch(spinHandler(() => gate));
    const user = userEvent.setup({ delay: null });
    const { client } = renderRoute(
      <>
        <Link to="/altrove">Esci dal tavolo</Link>
        <SlotPage />
      </>,
      { path: '/slot' },
    );
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: 'Gira (1 fiche)' }));
    await user.click(screen.getByRole('link', { name: 'Esci dal tavolo' }));
    expect(screen.getByText('altra pagina')).toBeInTheDocument();

    release();
    const expected = spinResponse(100).balance;
    await waitFor(() =>
      expect(client.getQueryData<MeResponse>(queryKeys.me)?.balance).toBe(expected),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.historyAll });
  });

  it('keeps the paytable inside a horizontal scroller on narrow screens', async () => {
    mockFetch(spinHandler());
    renderRoute(<SlotPage />, { path: '/slot' });
    const table = await screen.findByRole('table');
    expect(table.parentElement).toHaveClass('table-scroll');
  });
});
