import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ORDER } from '@casino/engine';
import { MAX_ANIMATION_MS, useReducedMotion } from '../../lib/motion.ts';
import { COLOR_NAMES_IT, numberColor } from './betBuilder.ts';

const STEP = 360 / WHEEL_ORDER.length;
const R_OUT = 96;
const R_IN = 66;

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

/** Rotation that brings `number` under the pointer after at least two full turns. */
export function wheelTarget(previous: number, number: number): number {
  const index = WHEEL_ORDER.indexOf(number);
  const target = -index * STEP;
  const delta = (((target - previous) % 360) + 360) % 360;
  return previous + 720 + delta;
}

interface RouletteWheelProps {
  /** Result to land on (null before the first spin). */
  number: number | null;
  /** Changes on every spin so the same number twice still animates. */
  spinId: number;
  /** Called once the wheel has stopped on `number`. */
  onSettled: () => void;
}

/** SVG European wheel: rotates and stops with the drawn pocket under the ball marker. */
export function RouletteWheel({ number, spinId, onSettled }: RouletteWheelProps) {
  const reduced = useReducedMotion();
  const [rotation, setRotation] = useState(0);
  const [ball, setBall] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const settledRef = useRef(onSettled);
  const startedFor = useRef(0);
  const doneFor = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const finish = useCallback((id: number) => {
    if (doneFor.current === id) return;
    doneFor.current = id;
    window.clearTimeout(timerRef.current);
    setSpinning(false);
    settledRef.current();
  }, []);

  const pockets = useMemo(
    () =>
      WHEEL_ORDER.map((n, i) => {
        const a0 = i * STEP - STEP / 2;
        const a1 = i * STEP + STEP / 2;
        const [x0, y0] = polar(R_OUT, a0);
        const [x1, y1] = polar(R_OUT, a1);
        const [x2, y2] = polar(R_IN, a1);
        const [x3, y3] = polar(R_IN, a0);
        const d = `M${x0} ${y0} A${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 0 0 ${x3} ${y3} Z`;
        const [tx, ty] = polar((R_OUT + R_IN) / 2 + 4, i * STEP);
        return { n, d, tx, ty, angle: i * STEP };
      }),
    [],
  );

  useEffect(() => {
    if (number === null || spinId === 0 || startedFor.current === spinId) return;
    startedFor.current = spinId;
    setRotation((prev) => wheelTarget(prev, number));
    setBall((prev) => prev - 1080);
    if (reduced) {
      finish(spinId);
      return;
    }
    setSpinning(true);
    // Fallback in case transitionend does not fire (background tab, CSS not loaded).
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => finish(spinId), MAX_ANIMATION_MS + 150);
  }, [spinId, number, reduced, finish]);

  const color = number === null ? null : numberColor(number);

  return (
    <div className={`wheel ${spinning ? 'is-spinning' : ''}`}>
      <svg viewBox="0 0 200 200" className="wheel-svg" aria-hidden="true" focusable="false">
        <circle cx="100" cy="100" r="99" className="wheel-rim" />
        <g
          className="wheel-rotor"
          style={{ transform: `rotate(${rotation}deg)` }}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget) finish(spinId);
          }}
        >
          {pockets.map((p) => (
            <g key={p.n}>
              <path d={p.d} className={`pocket pocket-${numberColor(p.n)}`} />
              <text
                x={p.tx}
                y={p.ty}
                className="pocket-text"
                transform={`rotate(${p.angle} ${p.tx} ${p.ty})`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {p.n}
              </text>
            </g>
          ))}
          <circle cx="100" cy="100" r={R_IN} className="wheel-bowl" />
          <path
            d="M100 48 L104 100 L100 152 L96 100 Z M48 100 L100 96 L152 100 L100 104 Z"
            className="wheel-spokes"
          />
          <circle cx="100" cy="100" r="10" className="wheel-hub" />
        </g>
        <g className="wheel-ball-track" style={{ transform: `rotate(${ball}deg)` }}>
          <circle cx="100" cy={100 - R_OUT + 12} r="5" className="wheel-ball" />
        </g>
        <path d="M94 0 L106 0 L100 10 Z" className="wheel-pointer" />
      </svg>
      <div className="wheel-result" aria-hidden="true">
        {number !== null && !spinning && color && (
          <span className={`wheel-result-badge rt-${color}`}>
            <span className="wheel-result-number">{number}</span>
            <span className="wheel-result-color">{COLOR_NAMES_IT[color]}</span>
          </span>
        )}
      </div>
    </div>
  );
}
