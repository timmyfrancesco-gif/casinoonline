import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Amount, GameId } from '@casino/engine';
import type {
  ChangePasswordRequest,
  DeleteAccountRequest,
  FairnessResponse,
  LoginRequest,
  MeResponse,
  RealityCheckRequest,
  RegisterRequest,
  RgStatus,
  RotateSeedRequest,
  SelfExclusionRequest,
  SetLossLimitRequest,
} from '@casino/shared';
import * as auth from './auth.ts';
import * as fairness from './fairness.ts';
import * as history from './history.ts';
import * as rg from './rg.ts';
import * as stats from './stats.ts';
import * as wallet from './wallet.ts';
import { isApiError } from './client.ts';

export const queryKeys = {
  me: ['me'] as const,
  rg: ['rg'] as const,
  stats: ['stats'] as const,
  fairness: ['fairness'] as const,
  historyAll: ['history'] as const,
  history: (game: GameId | undefined, cursor: string | undefined) =>
    ['history', { game: game ?? null, cursor: cursor ?? null }] as const,
  round: (id: string) => ['round', id] as const,
  open: (game: 'blackjack' | 'videopoker') => ['open', game] as const,
  rouletteRecent: ['roulette', 'recent'] as const,
};

/** Retry only when the request may not have reached the server (same variables = same idempotency key). */
export function retryOnNetworkError(failureCount: number, error: unknown): boolean {
  return isApiError(error) && error.code === 'NETWORK_ERROR' && failureCount < 2;
}

// ---------------------------------------------------------------------------
// Session & balance
// ---------------------------------------------------------------------------

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: auth.getMe, staleTime: 60_000 });
}

/** Balance shown in the header (null when logged out or loading). */
export function useBalance(): Amount | null {
  const { data } = useMe();
  return data ? data.balance : null;
}

export function setCachedBalance(client: QueryClient, balance: Amount): void {
  client.setQueryData<MeResponse | null>(queryKeys.me, (old) => (old ? { ...old, balance } : old));
}

export function useSetBalance(): (balance: Amount) => void {
  const client = useQueryClient();
  return useCallback((balance: Amount) => setCachedBalance(client, balance), [client]);
}

/** After a round changes state: history, statistics, loss-limit usage and nonces are stale. */
export function useInvalidateAfterRound(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.historyAll });
    void client.invalidateQueries({ queryKey: queryKeys.stats });
    void client.invalidateQueries({ queryKey: queryKeys.rg });
    void client.invalidateQueries({ queryKey: queryKeys.fairness });
  }, [client]);
}

function afterLogin(client: QueryClient, me: MeResponse): void {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  client.setQueryData(queryKeys.me, me);
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => auth.login(body),
    onSuccess: (me) => afterLogin(client, me),
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => auth.register(body),
    onSuccess: (me) => afterLogin(client, me),
  });
}

function clearSession(client: QueryClient): void {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  client.setQueryData(queryKeys.me, null);
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => auth.logout(),
    // Even if the request fails the local session view is dropped.
    onSettled: () => clearSession(client),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (body: ChangePasswordRequest) => auth.changePassword(body) });
}

/** Drops the local session view (queries of the previous user included). */
export function useClearSession(): () => void {
  const client = useQueryClient();
  return useCallback(() => clearSession(client), [client]);
}

/** The caller drops the local session once it has left private pages (see useLeaveToLobby). */
export function useDeleteAccount() {
  return useMutation({ mutationFn: (body: DeleteAccountRequest) => auth.deleteAccount(body) });
}

export function useResetWallet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => wallet.resetWallet(),
    onSuccess: (data) => {
      setCachedBalance(client, data.balance);
      void client.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

// ---------------------------------------------------------------------------
// Responsible gaming
// ---------------------------------------------------------------------------

export function useRg(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rg,
    queryFn: rg.getRg,
    enabled,
    staleTime: 30_000,
    // A pause set in another tab must show up here too. (Not for `me`: a refetch during a
    // roulette or slot animation would reveal the final balance.)
    refetchOnWindowFocus: true,
  });
}

function useRgMutation<T>(fn: (body: T) => Promise<RgStatus>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => client.setQueryData(queryKeys.rg, data),
  });
}

export function useSetLossLimit() {
  return useRgMutation((body: SetLossLimitRequest) => rg.setLossLimit(body));
}

export function useSelfExclude() {
  return useRgMutation((body: SelfExclusionRequest) => rg.selfExclude(body));
}

export function useSetRealityCheck() {
  return useRgMutation((body: RealityCheckRequest) => rg.setRealityCheck(body));
}

/** Active self-exclusion end (ISO) or null. */
export function useSelfExclusionUntil(): string | null {
  const { data: me } = useMe();
  const { data } = useRg(Boolean(me));
  const until = data?.selfExclusion.until ?? null;
  return until && new Date(until).getTime() > Date.now() ? until : null;
}

// ---------------------------------------------------------------------------
// Stats, fairness, history
// ---------------------------------------------------------------------------

export function useStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: stats.getStats });
}

export function useFairness() {
  return useQuery({ queryKey: queryKeys.fairness, queryFn: fairness.getFairness });
}

export function useRotateSeeds() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RotateSeedRequest) => fairness.rotateSeeds(body),
    onSuccess: (data: FairnessResponse) => {
      client.setQueryData(queryKeys.fairness, data);
      // Rounds of the revealed pair now expose their server seed.
      void client.invalidateQueries({ queryKey: ['round'] });
      void client.invalidateQueries({ queryKey: queryKeys.historyAll });
    },
    onError: (err) => {
      // Rotated elsewhere meanwhile: show the current next-seed hash before any retry.
      if (isApiError(err) && err.code === 'CONFLICT') {
        void client.invalidateQueries({ queryKey: queryKeys.fairness });
      }
    },
  });
}

export function useHistory(game: GameId | undefined, cursor: string | undefined, limit = 25) {
  return useQuery({
    queryKey: queryKeys.history(game, cursor),
    queryFn: () => history.getHistory({ game, cursor, limit }),
    placeholderData: keepPreviousData,
  });
}

export function useRoundDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.round(id ?? ''),
    queryFn: () => history.getRoundDetail(id ?? ''),
    enabled: Boolean(id),
  });
}
