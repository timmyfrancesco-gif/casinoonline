import type { WalletResponse } from '@casino/shared';
import { apiFetch } from './client.ts';

export function getWallet(): Promise<WalletResponse> {
  return apiFetch<WalletResponse>('/wallet');
}

export function resetWallet(): Promise<WalletResponse> {
  return apiFetch<WalletResponse>('/wallet/reset', { method: 'POST' });
}
