import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { settleRoulette, type RouletteBet } from '@casino/engine';
import type { MeResponse, RouletteSpinResponse } from '@casino/shared';
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
import { RoulettePage } from './RoulettePage.tsx';

function spinResponse(bets: RouletteBet[], number: number): RouletteSpinResponse {
  const settlement = settleRoulette(bets, number);
  return {
    round: {
      id: '5',
      game: 'roulette',
      status: 'settled',
      stake: settlement.totalBet,
      payout: settlement.totalWin,
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
    balance: ME.balance - settlement.totalBet + settlement.totalWin,
  };
}

/** Spin handler answering with `number`; other API calls get an empty answer. */
function spinHandler(number: number, before?: () => Promise<void> | void) {
  return async ({ url, body }: RecordedCall) => {
    if (url === '/api/auth/me') return jsonResponse(ME);
    if (url === '/api/rg') return jsonResponse(RG);
    if (url === '/api/games/roulette/spin') {
      await before?.();
      return jsonResponse(spinResponse((body as { bets: RouletteBet[] }).bets, number));
    }
    if (url.startsWith('/api/')) return jsonResponse({});
    return errorResponse(404, 'NOT_FOUND');
  };
}

const spinCalls = (calls: RecordedCall[]) =>
  calls.filter((c) => c.url === '/api/games/roulette/spin');

function TableWithExit() {
  return (
    <>
      <Link to="/altrove">Esci dal tavolo</Link>
      <RoulettePage />
    </>
  );
}

describe('RoulettePage', () => {
  it('builds bets from table clicks and the bet-type selector, spins and shows per-bet results', async () => {
    const { calls } = mockFetch(({ url, body }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      if (url === '/api/games/roulette/spin') {
        return jsonResponse(spinResponse((body as { bets: RouletteBet[] }).bets, 17));
      }
      if (url.startsWith('/api/')) return jsonResponse({});
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });

    // Default chip = 1 (table minimum): straight on 17 and red.
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('button', { name: 'Rosso' }));
    // Keyboard-friendly selector: split 17-18 by picking two numbers.
    await user.click(screen.getByRole('radio', { name: /Cavallo/ }));
    await user.click(screen.getByRole('button', { name: /^17 nero/ }));
    await user.click(screen.getByRole('button', { name: /^18 rosso/ }));
    expect(screen.getByText('Cavallo 17-18')).toBeInTheDocument();
    expect(screen.getByText('3 fiches')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/games/roulette/spin')).toBe(true));
    const request = calls.find((c) => c.url === '/api/games/roulette/spin')!;
    expect(request.body).toMatchObject({
      bets: [
        { type: 'straight', numbers: [17], amount: 100 },
        { type: 'red', amount: 100 },
        { type: 'split', numbers: [17, 18], amount: 100 },
      ],
    });
    expect((request.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    // Reduced motion in tests: the wheel settles immediately.
    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    expect(screen.getByText(/Rientrano 54 fiches/, { selector: '.outcome p' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.some((t) => t.includes('Pieno 17') && t.includes('Vinta'))).toBe(true);
    expect(rows.some((t) => t.includes('Rosso') && t.includes('Persa'))).toBe(true);
    expect(screen.getByRole('list', { name: /Ultimi numeri/ })).toHaveTextContent('17');
  });

  it('refuses chips beyond the table limit per bet', async () => {
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/rg') return jsonResponse(RG);
      return jsonResponse({});
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('radio', { name: /100 fiches/ }));
    await user.click(screen.getByRole('button', { name: 'Nero' }));
    await user.click(screen.getByRole('button', { name: /^Nero/ }));
    expect(
      await screen.findByText(/Massimo 100 fiches su una singola puntata/, {
        selector: '.alert *',
      }),
    ).toBeInTheDocument();
  });

  it('does not celebrate a winning bet in a spin lost overall, and tags red/black in words', async () => {
    mockFetch(spinHandler(3));
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('radio', { name: '5 fiches' }));
    await user.click(screen.getByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('radio', { name: '1 fiche' }));
    await user.click(screen.getByRole('button', { name: 'Rosso' }));
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));

    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    expect(screen.getByText(/Risultato netto: −4 fiches/)).toBeInTheDocument();
    const red = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Rosso'));
    expect(red).toHaveClass('row-current');
    expect(red).toHaveTextContent('Rientro parziale');
    expect(document.querySelector('tr.row-win')).toBeNull();
    // The recent numbers show R/N, not only a colour.
    const recent = screen.getByRole('list', { name: /Ultimi numeri/ });
    expect(within(recent).getByText('R')).toBeInTheDocument();
  });

  it('sends one bet for a double click on «Gira la ruota»', async () => {
    const { calls } = mockFetch(spinHandler(17));
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.dblClick(screen.getByRole('button', { name: 'Gira la ruota' }));

    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    expect(spinCalls(calls)).toHaveLength(1);
  });

  it('after an uncertain failure reuses the key for the same bets and says a retry is safe', async () => {
    let fail = true;
    const handler = spinHandler(17);
    const { calls } = mockFetch((call) =>
      call.url === '/api/games/roulette/spin' && fail
        ? errorResponse(500, 'INTERNAL')
        : handler(call),
    );
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));

    // Announced once, by the alert itself (not copied into the page's live region).
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Esito incerto/);
    expect(screen.getAllByText(/Esito incerto/)).toHaveLength(1);
    // The header balance is resynchronised.
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/auth/me').length).toBeGreaterThan(1),
    );

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));
    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ripeti puntate' }));
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));
    await waitFor(() => expect(spinCalls(calls)).toHaveLength(3));

    const keys = spinCalls(calls).map((c) => (c.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('re-announces an identical notice and shows it without a second live region', async () => {
    mockFetch(spinHandler(17));
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('radio', { name: '100 fiches' }));
    await user.click(screen.getByRole('button', { name: /^Nero/ }));
    await user.click(screen.getByRole('button', { name: /^Nero/ }));
    const region = document.querySelector('[aria-live="polite"]')!;
    const first = region.textContent;
    expect(first).toMatch(/Massimo 100 fiches/);
    await user.click(screen.getByRole('button', { name: /^Nero/ }));
    expect(region.textContent).toMatch(/Massimo 100 fiches/);
    expect(region.textContent).not.toBe(first);
    const notice = screen.getByText(/Massimo 100 fiches/, { selector: '.alert *' });
    expect(notice.closest('.alert')).not.toHaveAttribute('role');
  });

  it('gives focus back to the controls after a spin started from the keyboard', async () => {
    mockFetch(spinHandler(17));
    const user = userEvent.setup({ delay: null });
    renderRoute(<RoulettePage />, { path: '/roulette' });
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    screen.getByRole('button', { name: 'Gira la ruota' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Esito per puntata')).toBeInTheDocument();
    // No bets left, so the spin button is disabled: the next step is «Ripeti puntate».
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ripeti puntate' })).toHaveFocus(),
    );
  });

  it('applies a spin answered after the player left the table', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch(spinHandler(17, () => gate));
    const user = userEvent.setup({ delay: null });
    const { client } = renderRoute(<TableWithExit />, { path: '/roulette' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));
    await user.click(screen.getByRole('link', { name: 'Esci dal tavolo' }));
    expect(screen.getByText('altra pagina')).toBeInTheDocument();

    release();
    await waitFor(() =>
      expect(client.getQueryData<MeResponse>(queryKeys.me)?.balance).toBe(ME.balance + 3_500),
    );
    expect(client.getQueryData(queryKeys.rouletteRecent)).toEqual([17]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.historyAll });
  });

  it('applies the result when the player leaves while the wheel is still turning', async () => {
    // Full motion: the wheel turns until its transition ends (never, in jsdom).
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    mockFetch(spinHandler(17));
    const user = userEvent.setup({ delay: null });
    const { client } = renderRoute(<TableWithExit />, { path: '/roulette' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', { name: '17 nero' }));
    await user.click(screen.getByRole('button', { name: 'Gira la ruota' }));
    expect(await screen.findByText('La pallina sta girando…')).toBeInTheDocument();
    // Only the stake is shown as taken while the ball runs.
    expect(client.getQueryData<MeResponse>(queryKeys.me)?.balance).toBe(ME.balance - 100);

    await user.click(screen.getByRole('link', { name: 'Esci dal tavolo' }));
    expect(client.getQueryData<MeResponse>(queryKeys.me)?.balance).toBe(ME.balance + 3_500);
    expect(client.getQueryData(queryKeys.rouletteRecent)).toEqual([17]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.historyAll });
  });
});
