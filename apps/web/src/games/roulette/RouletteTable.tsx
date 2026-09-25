import { useMemo, useState, type CSSProperties } from 'react';
import type { Amount } from '@casino/engine';
import { ChipToken } from '../../components/Chip.tsx';
import { chipsLabel } from '../../lib/format.ts';
import {
  COLOR_NAMES_IT,
  TABLE_H,
  TABLE_W,
  VERTICAL_H,
  VERTICAL_W,
  betLabel,
  insideHotspots,
  numberColor,
  numberRect,
  outsideSpots,
  targetNumbers,
  toVerticalPoint,
  toVerticalRect,
  type BetTarget,
  type Point,
  type Rect,
} from './betBuilder.ts';

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

/** Position of a rect in both layouts via CSS custom properties (switched by a media query). */
function rectStyle(r: Rect): CSSProperties {
  const v = toVerticalRect(r);
  return {
    '--hl': pct(r.x, TABLE_W),
    '--ht': pct(r.y, TABLE_H),
    '--hw': pct(r.w, TABLE_W),
    '--hh': pct(r.h, TABLE_H),
    '--vl': pct(v.x, VERTICAL_W),
    '--vt': pct(v.y, VERTICAL_H),
    '--vw': pct(v.w, VERTICAL_W),
    '--vh': pct(v.h, VERTICAL_H),
  } as CSSProperties;
}

function pointStyle(p: Point): CSSProperties {
  const v = toVerticalPoint(p);
  return {
    '--hx': pct(p.x, TABLE_W),
    '--hy': pct(p.y, TABLE_H),
    '--vx': pct(v.x, VERTICAL_W),
    '--vy': pct(v.y, VERTICAL_H),
  } as CSSProperties;
}

interface RouletteTableProps {
  /** Amount on each bet key. */
  stakes: ReadonlyMap<string, Amount>;
  onNumber: (n: number) => void;
  onTarget: (target: BetTarget) => void;
  disabled: boolean;
  /** Numbers highlighted by pick mode (selection candidates). */
  highlighted: ReadonlySet<number>;
  /** Numbers already picked in pick mode. */
  selected: ReadonlySet<number>;
  winning: number | null;
  /** When false (pick mode), edge hotspots are hidden. */
  showHotspots: boolean;
}

const NUMBERS = Array.from({ length: 37 }, (_, n) => n);

export function RouletteTable({
  stakes,
  onNumber,
  onTarget,
  disabled,
  highlighted,
  selected,
  winning,
  showHotspots,
}: RouletteTableProps) {
  const hotspots = useMemo(() => insideHotspots(), []);
  const outside = useMemo(() => outsideSpots(), []);
  const [preview, setPreview] = useState<ReadonlySet<number>>(new Set());

  const previewTarget = (target: BetTarget | null) =>
    setPreview(target ? new Set(targetNumbers(target)) : new Set());

  return (
    <div className="roulette-table" role="group" aria-label="Tappeto della roulette">
      {NUMBERS.map((n) => {
        const color = numberColor(n);
        const key = `straight:${n}`;
        const stake = stakes.get(key);
        const classes = [
          'rt-item',
          'rt-number',
          `rt-${color}`,
          highlighted.has(n) || preview.has(n) ? 'is-highlighted' : '',
          selected.has(n) ? 'is-selected' : '',
          winning === n ? 'is-winning' : '',
        ].join(' ');
        return (
          <button
            key={n}
            type="button"
            className={classes}
            style={rectStyle(numberRect(n))}
            onClick={() => onNumber(n)}
            onMouseEnter={() => previewTarget({ type: 'straight', numbers: [n] })}
            onMouseLeave={() => previewTarget(null)}
            disabled={disabled}
            aria-label={`${n} ${COLOR_NAMES_IT[color]}${stake ? `, puntata ${chipsLabel(stake)}` : ''}`}
          >
            <span className="rt-number-text">{n}</span>
            {color !== 'green' && (
              <span className="rt-color-tag" aria-hidden="true">
                {color === 'red' ? 'R' : 'N'}
              </span>
            )}
            {stake ? <ChipToken units={stake} className="rt-chip" /> : null}
          </button>
        );
      })}

      {outside.map((spot) => {
        const stake = stakes.get(spot.key);
        const colorClass =
          spot.target.type === 'red' ? 'rt-red' : spot.target.type === 'black' ? 'rt-black' : '';
        return (
          <button
            key={spot.key}
            type="button"
            className={`rt-item rt-outside ${colorClass} rt-${spot.target.type}`}
            style={rectStyle(spot.rect)}
            onClick={() => onTarget(spot.target)}
            onMouseEnter={() => previewTarget(spot.target)}
            onMouseLeave={() => previewTarget(null)}
            onFocus={() => previewTarget(spot.target)}
            onBlur={() => previewTarget(null)}
            disabled={disabled}
            aria-label={`${betLabel(spot.target)}${stake ? `, puntata ${chipsLabel(stake)}` : ''}`}
          >
            <span className="rt-outside-text">
              {spot.target.type === 'red' || spot.target.type === 'black' ? (
                <>
                  <span className="rt-diamond" aria-hidden="true" />
                  {spot.text}
                </>
              ) : (
                spot.text
              )}
            </span>
            {stake ? <ChipToken units={stake} className="rt-chip" /> : null}
          </button>
        );
      })}

      {hotspots.map((spot) => {
        const stake = stakes.get(spot.key);
        if (!showHotspots && !stake) return null;
        return (
          <button
            key={spot.key}
            type="button"
            className={`rt-hotspot ${stake ? 'has-chip' : ''} ${showHotspots ? '' : 'is-passive'}`}
            style={pointStyle(spot.at)}
            onClick={() => onTarget(spot.target)}
            onMouseEnter={() => previewTarget(spot.target)}
            onMouseLeave={() => previewTarget(null)}
            disabled={disabled || !showHotspots}
            // Mouse/touch shortcut: keyboard users build these bets with the bet-type selector.
            tabIndex={-1}
            aria-label={`${betLabel(spot.target)}${stake ? `, puntata ${chipsLabel(stake)}` : ''}`}
          >
            {stake ? (
              <ChipToken units={stake} />
            ) : (
              <span className="rt-hotspot-dot" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
