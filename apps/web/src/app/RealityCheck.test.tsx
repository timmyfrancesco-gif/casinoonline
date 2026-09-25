import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME, RG, errorResponse, jsonResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { RealityCheck, nextRealityCheckDue } from './RealityCheck.tsx';

const MIN = 60_000;

describe('nextRealityCheckDue', () => {
  it('returns the next multiple of the interval after the acknowledged time', () => {
    expect(nextRealityCheckDue(0, 30 * MIN)).toBe(30 * MIN);
    expect(nextRealityCheckDue(31 * MIN, 30 * MIN)).toBe(60 * MIN);
    expect(nextRealityCheckDue(30 * MIN, 15 * MIN)).toBe(45 * MIN);
  });
});

/** Session started almost 15 minutes ago (15-minute interval): the check is due in ~20 ms. */
function mockDueSession() {
  const startedAt = Date.now() - (15 * MIN - 20);
  const rg = () => ({
    ...RG,
    realityCheckMinutes: 15 as const,
    session: { ...RG.session, elapsedMs: Date.now() - startedAt, rounds: 12, net: -2_550 },
  });
  mockFetch(({ url }) => {
    if (url === '/api/auth/me') return jsonResponse(ME);
    if (url === '/api/rg') return jsonResponse(rg());
    return errorResponse(404, 'NOT_FOUND');
  });
}

async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('RealityCheck', () => {
  // Acknowledgements are stored per session start: each test starts from a fresh session.
  beforeEach(() => sessionStorage.clear());

  it('shows a blocking dialog with time, rounds and net result, then lets the player continue', async () => {
    mockDueSession();
    const user = userEvent.setup({ delay: null });
    renderRoute(<RealityCheck />);

    const dialog = await screen.findByRole('alertdialog', { name: 'Promemoria di gioco' });
    expect(dialog).toHaveTextContent('15 min');
    expect(dialog).toHaveTextContent('12 partite');
    expect(dialog).toHaveTextContent('−25,50');
    expect(screen.getByRole('button', { name: 'Esci' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continua a giocare' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const stored = Object.keys(sessionStorage).find((k) => k.startsWith('casino-rc-ack:'));
    expect(Number(sessionStorage.getItem(stored!))).toBeGreaterThanOrEqual(15 * MIN - 20);
  });

  it('does not nudge towards continuing: no autofocus on Continue, helpline and RG link shown', async () => {
    mockDueSession();
    renderRoute(<RealityCheck />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Promemoria di gioco' });
    expect(dialog).toHaveFocus();
    const continueButton = screen.getByRole('button', { name: 'Continua a giocare' });
    expect(continueButton).not.toHaveClass('btn-primary');
    expect(dialog).toHaveTextContent('800 558 822');
    expect(screen.getByRole('link', { name: 'Gioco responsabile' })).toHaveAttribute(
      'href',
      '/gioco-responsabile',
    );
  });

  it('opening the responsible gaming page acknowledges the check', async () => {
    mockDueSession();
    const user = userEvent.setup({ delay: null });
    renderRoute(<RealityCheck />);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('link', { name: 'Gioco responsabile' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await settle(50);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('stays dismissed when session storage is unavailable', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    mockDueSession();
    const user = userEvent.setup({ delay: null });
    renderRoute(<RealityCheck />);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Continua a giocare' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // Without the in-memory acknowledgement the next check would be due at once.
    await settle(50);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
