import { useId } from 'react';
import { UNITS_PER_CHIP, type Amount } from '@casino/engine';
import type { TableLimits } from '@casino/shared';
import { chipsLabel } from '../lib/format.ts';
import { chipTone } from './Chip.tsx';

interface StakeSelectorProps {
  /** Stake in units (whole chips). */
  value: Amount;
  onChange: (units: Amount) => void;
  limits: TableLimits;
  /** Current balance; stakes above it are flagged. */
  balance: Amount | null;
  disabled?: boolean;
  presets?: readonly number[];
}

/** Stake picker: −/+ by one chip plus preset chips, clamped to the table limits. */
export function StakeSelector({
  value,
  onChange,
  limits,
  balance,
  disabled = false,
  presets = [1, 5, 10, 25, 50, 100],
}: StakeSelectorProps) {
  const id = useId();
  const min = limits.min;
  const max = limits.maxPerBet;
  const clamp = (units: Amount) => Math.min(max, Math.max(min, units));
  const available = presets.filter((c) => c * UNITS_PER_CHIP <= max);
  const overBalance = balance !== null && value > balance;

  return (
    <fieldset className="stake-selector" disabled={disabled}>
      <legend>Puntata</legend>
      <div className="stake-row">
        <button
          type="button"
          className="btn btn-round"
          onClick={() => onChange(clamp(value - UNITS_PER_CHIP))}
          disabled={value <= min}
          aria-label="Diminuisci la puntata di 1 fiche"
        >
          −
        </button>
        <output className="stake-value" id={`${id}-value`} aria-live="polite">
          {chipsLabel(value)}
        </output>
        <button
          type="button"
          className="btn btn-round"
          onClick={() => onChange(clamp(value + UNITS_PER_CHIP))}
          disabled={value >= max}
          aria-label="Aumenta la puntata di 1 fiche"
        >
          +
        </button>
      </div>
      <div className="stake-presets" role="group" aria-label="Puntate rapide">
        {available.map((chips) => {
          const units = chips * UNITS_PER_CHIP;
          return (
            <button
              key={chips}
              type="button"
              className={`chip-button ${chipTone(chips)}`}
              aria-pressed={value === units}
              onClick={() => onChange(clamp(units))}
              aria-label={`${chips} ${chips === 1 ? 'fiche' : 'fiches'}`}
            >
              {chips}
            </button>
          );
        })}
      </div>
      <p className="stake-hint">
        Limiti del tavolo: da {chipsLabel(min)} a {chipsLabel(max)}.
        {overBalance && <span className="text-warning"> La puntata supera il saldo.</span>}
      </p>
    </fieldset>
  );
}
