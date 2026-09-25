import type {
  RealityCheckRequest,
  RgStatus,
  SelfExclusionRequest,
  SetLossLimitRequest,
} from '@casino/shared';
import { apiFetch } from './client.ts';

export function getRg(): Promise<RgStatus> {
  return apiFetch<RgStatus>('/rg');
}

export function setLossLimit(body: SetLossLimitRequest): Promise<RgStatus> {
  return apiFetch<RgStatus>('/rg/loss-limit', { method: 'PUT', body });
}

export function selfExclude(body: SelfExclusionRequest): Promise<RgStatus> {
  return apiFetch<RgStatus>('/rg/self-exclusion', { method: 'POST', body });
}

export function setRealityCheck(body: RealityCheckRequest): Promise<RgStatus> {
  return apiFetch<RgStatus>('/rg/reality-check', { method: 'PUT', body });
}
