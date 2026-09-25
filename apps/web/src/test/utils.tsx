import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { ApiErrorBody, ErrorCode, MeResponse, RgStatus } from '@casino/shared';
import { createQueryClient } from '../app/queryClient.ts';
import { routes } from '../app/routes.tsx';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message = 'Errore',
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return jsonResponse(body, status);
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** Replaces global fetch; the handler receives the parsed request. */
export function mockFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: RecordedCall = {
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  return client;
}

/** Renders one element at a route, with a fresh query client. */
export function renderRoute(
  element: ReactElement,
  { path = '/', url }: { path?: string; url?: string } = {},
) {
  const client = testQueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url ?? path]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<p>altra pagina</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

/** Renders the whole application router at `url`. */
export function renderApp(url: string) {
  const client = testQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, client, router };
}

export const ME: MeResponse = {
  user: { id: '1', username: 'mario', createdAt: '2026-01-01T10:00:00.000Z' },
  balance: 100_000,
  sessionStartedAt: '2026-09-25T10:00:00.000Z',
};

export const RG: RgStatus = {
  lossLimits: {
    '24h': { value: null, pending: null, used: 0, remaining: null },
    '7d': { value: null, pending: null, used: 0, remaining: null },
    '30d': { value: null, pending: null, used: 0, remaining: null },
  },
  selfExclusion: { until: null },
  realityCheckMinutes: 30,
  session: { startedAt: '2026-09-25T10:00:00.000Z', elapsedMs: 60_000, rounds: 0, net: 0 },
};
