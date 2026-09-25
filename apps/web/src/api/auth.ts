import type {
  ChangePasswordRequest,
  DeleteAccountRequest,
  LoginRequest,
  MeResponse,
  RegisterRequest,
} from '@casino/shared';
import { ApiError, apiFetch } from './client.ts';

/** Current user, or null when not logged in (401 is not an error here). */
export async function getMe(): Promise<MeResponse | null> {
  try {
    return await apiFetch<MeResponse>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function login(body: LoginRequest): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/login', { method: 'POST', body });
}

export function register(body: RegisterRequest): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/register', { method: 'POST', body });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function changePassword(body: ChangePasswordRequest): Promise<void> {
  return apiFetch<void>('/account/password', { method: 'POST', body });
}

export function deleteAccount(body: DeleteAccountRequest): Promise<void> {
  return apiFetch<void>('/account', { method: 'DELETE', body });
}
