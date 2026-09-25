import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SLOT_STRIP, SLOT_STRIP_LENGTH, type SlotSymbol } from '@casino/engine';
import { useReducedMotion } from '../../lib/motion.ts';
import { SlotSymbolIcon } from './symbols.tsx';

/** Copies of the strip rendered in each reel: rest in copy 1, stop in copy 3. */
const COPIES = 5;

/** Index (in the repeated strip) of the top visible row when `stop` is on the payline. */
export function reelPosition(stop: number, copy: number): number {
  const len = SLOT_STRIP_LENGTH;
  return copy * len + ((((stop - 1) % len) + len) % len);
}

interface ReelProps {
  index: number;
  stop: number;
  spinId: number;
  /** Symbols to show when the strip is not available (fallback): [above, line, below]. */
  fallback: SlotSymbol[] | null;
  durationMs: number;
  onStopped: (index: number) => void;
  highlight: boolean;
}

/** One reel: the real strip scrolls and stops exactly on the server's stop (no fake symbols). */
export function Reel({
  index,
  stop,
  spinId,
  fallback,
  durationMs,
  onStopped,
  highlight,
}: ReelProps) {
  const reduced = useReducedMotion();
  const hasStrip = SLOT_STRIP.length === SLOT_STRIP_LENGTH;
  const [pos, setPos] = useState(() => reelPosition(stop, 1));
  const [animating, setAnimating] = useState(false);
  const startedFor = useRef(0);
  const doneFor = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const stoppedRef = useRef(onStopped);

  useEffect(() => {
    stoppedRef.current = onStopped;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = useCallback(
    (id: number, finalStop: number) => {
      if (doneFor.current === id) return;
      doneFor.current = id;
      window.clearTimeout(timer.current);
      setAnimating(false);
      setPos(reelPosition(finalStop, 1));
      stoppedRef.current(index);
    },
    [index],
  );

  useEffect(() => {
    if (spinId === 0 || startedFor.current === spinId) return;
    startedFor.current = spinId;
    if (reduced || !hasStrip) {
      finish(spinId, stop);
      return;
    }
    setAnimating(true);
    setPos(reelPosition(stop, 3));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => finish(spinId, stop), durationMs + 150);
  }, [spinId, stop, reduced, hasStrip, durationMs, finish]);

  if (!hasStrip) {
    return (
      <div className={`reel ${highlight ? 'is-highlighted' : ''}`} aria-hidden="true">
        <div className="reel-strip reel-static">
          {(fallback ?? []).map((symbol, row) => (
            <div key={row} className="reel-cell">
              <SlotSymbolIcon symbol={symbol} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const style = {
    '--reel-pos': pos,
    '--reel-duration': `${durationMs}ms`,
  } as CSSProperties;

  return (
    <div className={`reel ${highlight ? 'is-highlighted' : ''}`} aria-hidden="true">
      <div
        className={`reel-strip ${animating ? 'is-spinning' : ''}`}
        style={style}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && animating) finish(spinId, stop);
        }}
      >
        {Array.from({ length: COPIES }, (_, copy) =>
          SLOT_STRIP.map((symbol, i) => (
            <div key={`${copy}-${i}`} className="reel-cell">
              <SlotSymbolIcon symbol={symbol} />
            </div>
          )),
        )}
      </div>
    </div>
  );
}
