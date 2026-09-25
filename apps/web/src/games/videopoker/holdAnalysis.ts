import { videoPokerHoldAnalysis, type CardCode } from '@casino/engine';

export interface HoldOption {
  held: boolean[];
  ev: number;
}

type WorkerReply = { ok: true; result: HoldOption[] } | { ok: false; message: string };

function analyseOnMainThread(hand: CardCode[]): Promise<HoldOption[]> {
  return new Promise((resolve, reject) => {
    // Yield first so the spinner can paint.
    window.setTimeout(() => {
      try {
        resolve(videoPokerHoldAnalysis(hand));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 30);
  });
}

/** Exact EV of every hold mask, computed in a Web Worker when available. */
export function analyseHolds(hand: CardCode[]): Promise<HoldOption[]> {
  if (typeof Worker === 'undefined') return analyseOnMainThread(hand);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./holdAnalysis.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      analyseOnMainThread(hand).then(resolve, reject);
      return;
    }
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      // Worker blocked (CSP, old browser): fall back to the main thread.
      analyseOnMainThread(hand).then(resolve, reject);
    };
    worker.postMessage(hand);
  });
}
