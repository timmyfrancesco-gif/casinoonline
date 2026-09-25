import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@casino/shared';
import { ApiError } from '../api/client.ts';
import { queryKeys } from '../api/hooks.ts';
import { ME } from '../test/utils.tsx';
import { createQueryClient } from './queryClient.ts';

/** Runs a mutation that fails with `error` and returns the client after its error handlers. */
async function failWith(error: ApiError) {
  const client = createQueryClient();
  client.setQueryData<MeResponse | null>(queryKeys.me, ME);
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const observer = new MutationObserver(client, { mutationFn: () => Promise.reject(error) });
  await observer.mutate().catch(() => undefined);
  return { client, invalidate };
}

describe('mutation error resync', () => {
  it('refreshes the RG state when a bet hits a pause or a loss limit set elsewhere', async () => {
    for (const code of ['RG_SELF_EXCLUDED', 'RG_LOSS_LIMIT'] as const) {
      const { invalidate } = await failWith(new ApiError(403, code, 'no'));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.rg });
    }
  });

  it('shows the balance the server reports with INSUFFICIENT_FUNDS', async () => {
    const { client } = await failWith(
      new ApiError(400, 'INSUFFICIENT_FUNDS', 'no', { balance: 2_500, required: 5_000 }),
    );
    expect(client.getQueryData<MeResponse>(queryKeys.me)?.balance).toBe(2_500);
  });

  it('refetches the balance for INSUFFICIENT_FUNDS without details', async () => {
    const { invalidate } = await failWith(new ApiError(400, 'INSUFFICIENT_FUNDS', 'no'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
  });

  it('resyncs balance and history when the outcome is uncertain', async () => {
    for (const error of [
      new ApiError(0, 'NETWORK_ERROR', 'rete'),
      new ApiError(200, 'BAD_RESPONSE', 'vuota'),
      new ApiError(502, 'INTERNAL', 'Errore 502'),
    ]) {
      const { invalidate } = await failWith(error);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.historyAll });
    }
  });

  it('leaves the cache alone for a definitive refusal', async () => {
    const { client, invalidate } = await failWith(new ApiError(400, 'BET_LIMIT', 'no'));
    expect(invalidate).not.toHaveBeenCalled();
    expect(client.getQueryData<MeResponse>(queryKeys.me)).toEqual(ME);
  });
});
