import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@casino/shared';
import { isApiError } from '../api/client.ts';
import { isUncertainOutcome } from '../api/errors.ts';
import { queryKeys, setCachedBalance } from '../api/hooks.ts';

function retryQuery(failureCount: number, error: unknown): boolean {
  if (!isApiError(error)) return failureCount < 1;
  // Only transient failures are retried; 4xx answers are final.
  const transient = error.code === 'NETWORK_ERROR' || error.status >= 500;
  return transient && failureCount < 2;
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isApiError(error) && error.code === 'UNAUTHENTICATED' && query.queryKey[0] !== 'me') {
          client.setQueryData<MeResponse | null>(queryKeys.me, null);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (!isApiError(error)) return;
        // Expired session during an action: drop the local user; guarded routes redirect to login.
        if (error.code === 'UNAUTHENTICATED') {
          client.setQueryData<MeResponse | null>(queryKeys.me, null);
          return;
        }
        // A pause or loss limit set elsewhere (another tab or device): refresh the RG state so
        // the tables disable play and show the banner.
        if (error.code === 'RG_SELF_EXCLUDED' || error.code === 'RG_LOSS_LIMIT') {
          void client.invalidateQueries({ queryKey: queryKeys.rg });
          return;
        }
        // The server tells the real balance: the header must not keep offering chips it refuses.
        if (error.code === 'INSUFFICIENT_FUNDS') {
          const balance = (error.details as { balance?: unknown } | null | undefined)?.balance;
          if (typeof balance === 'number') setCachedBalance(client, balance);
          else void client.invalidateQueries({ queryKey: queryKeys.me });
          return;
        }
        // The request may have been applied: resync balance and history from the server.
        if (isUncertainOutcome(error)) {
          void client.invalidateQueries({ queryKey: queryKeys.me });
          void client.invalidateQueries({ queryKey: queryKeys.historyAll });
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: retryQuery,
        refetchOnWindowFocus: false,
        staleTime: 15_000,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
