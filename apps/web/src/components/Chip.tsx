import { useId } from 'react';
import { UNITS_PER_CHIP, formatChips, type Amount } from '@casino/engine';

/** Chip denominations in whole chips; colours are decorative, the value is always written. */
export const CHIP_VALUES = [1, 5, 25, 100] as const;

export function chipTone(chips: number): string {
  if (chips >= 100) return 'chip-100';
  if (chips >= 25) return 'chip-25';
  if (chips >= 5) return 'chip-5';
  return 'chip-1';
}

/** A chip-shaped token showing an amount in units (used on the roulette table). */
export function ChipToken({ units, className }: { units: Amount; className?: string }) {
  const chips = units / UNITS_PER_CHIP;
  return (
    <span className={`chip-token ${chipTone(chips)} ${className ?? ''}`} aria-hidden="true">
      {formatChips(units)}
    </span>
  );
}

interface ChipSelectorProps {
  /** Selected value in whole chips. */
  value: number;
  onChange: (chips: number) => void;
  values?: readonly number[];
  /** Values above this (in chips) are disabled. */
  max?: number;
  label?: string;
  disabled?: boolean;
}

/** Radio group of chips (arrow keys move between chips). */
export function ChipSelector({
  value,
  onChange,
  values = CHIP_VALUES,
  max,
  label = 'Valore della fiche',
  disabled = false,
}: ChipSelectorProps) {
  const name = useId();
  return (
    <fieldset className="chip-selector" disabled={disabled}>
      <legend>{label}</legend>
      <div className="chip-selector-row">
        {values.map((chips) => {
          const tooBig = max !== undefined && chips > max;
          return (
            <label key={chips} className={`chip-option ${chipTone(chips)}`}>
              <input
                type="radio"
                name={name}
                value={chips}
                checked={value === chips}
                disabled={tooBig}
                onChange={() => onChange(chips)}
                aria-label={`${chips} ${chips === 1 ? 'fiche' : 'fiches'}`}
              />
              <span className="chip-face" aria-hidden="true">
                <span className="chip-value">{chips}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
