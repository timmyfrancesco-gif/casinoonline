// Runs the exact 32-mask EV analysis off the main thread so the spinner keeps animating.
import { videoPokerHoldAnalysis } from '@casino/engine';

self.onmessage = (event: MessageEvent<number[]>) => {
  try {
    self.postMessage({ ok: true, result: videoPokerHoldAnalysis(event.data) });
  } catch (err) {
    self.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
