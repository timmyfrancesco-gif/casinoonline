/**
 * Amounts are integers expressed in "units": 1 chip (fiche) = 100 units.
 * Using integers avoids floating point drift; 100 units per chip lets
 * blackjack pay 3:2 on any whole-chip bet without rounding.
 *
 * Chips are virtual and have no monetary value.
 */
export type Amount = number;

export const UNITS_PER_CHIP = 100;

/** Balance granted on registration and restored by "Ricomincia". */
export const STARTING_BALANCE: Amount = 1_000 * UNITS_PER_CHIP;

export function chips(n: number): Amount {
  return Math.round(n * UNITS_PER_CHIP);
}

export function isValidAmount(value: unknown): value is Amount {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Formats units as chips with Italian separators, e.g. 150050 -> "1.500,50". */
export function formatChips(units: Amount): string {
  const negative = units < 0;
  const abs = Math.abs(units);
  const whole = Math.floor(abs / UNITS_PER_CHIP);
  const cents = abs % UNITS_PER_CHIP;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = cents === 0 ? wholeStr : `${wholeStr},${cents.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}
