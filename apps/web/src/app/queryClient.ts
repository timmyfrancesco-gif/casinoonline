import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@casino/shared';
import { isApiError } from '../api/client.ts';
import { queryKeys } from '../api/hooks.ts';

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
        // Expired session during an action: drop the local user; guarded routes redirect to login.
        if (isApiError(error) && error.code === 'UNAUTHENTICATED') {
          client.setQueryData<MeResponse | null>(queryKeys.me, null);
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
