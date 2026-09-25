import { useCallback, useRef } from 'react';
import { isUncertainOutcome } from './errors.ts';

/**
 * Idempotency keys: one UUID per bet intent (click). Automatic retries of the same
 * request reuse the key, so the server never settles the same bet twice.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // randomUUID only exists in secure contexts (HTTPS/localhost): build a v4 UUID by hand.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The key of a bet intent across clicks. When a request ends without a definitive answer
 * (network failure, 5xx) the bet may already be settled: clicking again with the same bet
 * (same fingerprint) reuses the key, so the server answers with that result instead of
 * taking the stake twice. A success or a definitive refusal ends the intent.
 */
export function useBetIdempotencyKey(): {
  keyFor: (fingerprint: string) => string;
  settle: (error?: unknown) => void;
} {
  const pending = useRef<{ key: string; fingerprint: string } | null>(null);
  const keyFor = useCallback((fingerprint: string) => {
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { key: newIdempotencyKey(), fingerprint };
    }
    return pending.current.key;
  }, []);
  const settle = useCallback((error?: unknown) => {
    if (error === undefined || !isUncertainOutcome(error)) pending.current = null;
  }, []);
  return { keyFor, settle };
}
