import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_SEED_PATTERN } from '@casino/engine';
import type { FairnessResponse } from '@casino/shared';
import { getCommitment } from '../lib/commitments.ts';
import { ME, errorResponse, jsonResponse, mockFetch, renderRoute } from '../test/utils.tsx';
import { ProfilePage } from './ProfilePage.tsx';

const FAIRNESS: FairnessResponse = {
  active: {
    id: '12',
    serverSeedHash: 'c'.repeat(64),
    clientSeed: 'seed-attuale',
    nextNonce: 4,
    createdAt: '2026-09-25T10:00:00.000Z',
  },
  next: { serverSeedHash: 'f'.repeat(64) },
  revealed: [
    {
      id: '11',
      serverSeed: 'd'.repeat(64),
      serverSeedHash: 'e'.repeat(64),
      clientSeed: 'seed-vecchio',
      roundsPlayed: 3,
      createdAt: '2026-09-24T10:00:00.000Z',
      revealedAt: '2026-09-25T10:00:00.000Z',
    },
  ],
};

/** After a rotation: the announced next seed is now active and a new one is announced. */
const ROTATED: FairnessResponse = {
  active: {
    id: '13',
    serverSeedHash: 'f'.repeat(64),
    clientSeed: 'mio-seed',
    nextNonce: 0,
    createdAt: '2026-09-25T11:00:00.000Z',
  },
  next: { serverSeedHash: '1'.repeat(64) },
  revealed: [
    {
      id: '12',
      serverSeed: '3'.repeat(64),
      serverSeedHash: 'c'.repeat(64),
      clientSeed: 'seed-attuale',
      roundsPlayed: 4,
      createdAt: '2026-09-25T10:00:00.000Z',
      revealedAt: '2026-09-25T11:00:00.000Z',
    },
    ...FAIRNESS.revealed,
  ],
};

describe('ProfilePage seeds', () => {
  beforeEach(() => localStorage.clear());

  it('rotates with a client seed generated in the browser when the field is empty', async () => {
    const { calls } = mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/fairness' || url === '/api/fairness/rotate') return jsonResponse(FAIRNESS);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ProfilePage />, { path: '/profilo' });

    expect(await screen.findByText('seed-attuale')).toBeInTheDocument();
    expect(screen.getByText(/ne generiamo uno casuale nel tuo browser/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ruota i seed/ }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/fairness/rotate')).toBe(true));
    const body = calls.find((c) => c.url === '/api/fairness/rotate')!.body as {
      clientSeed?: string;
    };
    expect(body.clientSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(CLIENT_SEED_PATTERN.test(body.clientSeed!)).toBe(true);
  });

  it('shows the next server seed hash and binds the rotation to it', async () => {
    const { calls } = mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/fairness') return jsonResponse(FAIRNESS);
      if (url === '/api/fairness/rotate') return jsonResponse(ROTATED);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ProfilePage />, { path: '/profilo' });

    const next = await screen.findByText('Hash del prossimo seed server');
    expect(next.nextElementSibling).toHaveTextContent('f'.repeat(64));
    expect(
      screen.getByText(/non può scegliere il proprio seed dopo aver visto il tuo/),
    ).toBeVisible();
    await user.type(screen.getByLabelText(/Nuovo seed client/), 'mio-seed');
    await user.click(screen.getByRole('button', { name: /Ruota i seed/ }));

    expect(
      await screen.findByText(/La nuova coppia attiva usa il seed server annunciato/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/fairness/rotate')!.body).toEqual({
      clientSeed: 'mio-seed',
      nextServerSeedHash: 'f'.repeat(64),
    });
    expect(getCommitment('13')?.hash).toBe('f'.repeat(64));
    // The new next seed is on screen for the following rotation.
    expect(next.nextElementSibling).toHaveTextContent('1'.repeat(64));
  });

  it('flags a new pair whose seed is not the announced one and keeps the announced hash', async () => {
    const swapped = { ...ROTATED, active: { ...ROTATED.active, serverSeedHash: '2'.repeat(64) } };
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/fairness') return jsonResponse(FAIRNESS);
      if (url === '/api/fairness/rotate') return jsonResponse(swapped);
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ProfilePage />, { path: '/profilo' });

    await user.click(await screen.findByRole('button', { name: /Ruota i seed/ }));
    const title = await screen.findByText('✗ Seed server diverso da quello annunciato');
    const alert = title.closest('[role="alert"]');
    expect(alert).toHaveTextContent('f'.repeat(64));
    expect(alert).toHaveTextContent('2'.repeat(64));
    // The verifier will compare the revealed seed with the hash announced before the rotation.
    expect(getCommitment('13')?.hash).toBe('f'.repeat(64));
  });

  it('reloads the seeds when they were rotated elsewhere meanwhile', async () => {
    let fetches = 0;
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/fairness') return jsonResponse(++fetches === 1 ? FAIRNESS : ROTATED);
      if (url === '/api/fairness/rotate') return errorResponse(409, 'CONFLICT');
      return errorResponse(404, 'NOT_FOUND');
    });
    const user = userEvent.setup({ delay: null });
    renderRoute(<ProfilePage />, { path: '/profilo' });

    await user.click(await screen.findByRole('button', { name: /Ruota i seed/ }));
    const message = await screen.findByText(/I seed sono stati ruotati nel frattempo/);
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(await screen.findByText('1'.repeat(64))).toBeInTheDocument();
    expect(fetches).toBe(2);
  });

  it('records the active commitment and links revealed pairs to the verifier by id', async () => {
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(ME);
      if (url === '/api/fairness') return jsonResponse(FAIRNESS);
      return errorResponse(404, 'NOT_FOUND');
    });
    renderRoute(<ProfilePage />, { path: '/profilo' });

    const link = await screen.findByRole('link', { name: 'Verifica con questa coppia' });
    expect(new URL(link.getAttribute('href')!, 'http://x').searchParams.get('pair')).toBe('11');
    expect(getCommitment('12')?.hash).toBe('c'.repeat(64));
    // A revealed pair's hash arrives with its seed: it proves nothing and is not recorded.
    expect(getCommitment('11')).toBeNull();
  });
});
