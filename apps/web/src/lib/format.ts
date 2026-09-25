import { UNITS_PER_CHIP, formatChips, type Amount } from '@casino/engine';

/** "1.000 fiches", "1 fiche", "12,50 fiches". */
export function chipsLabel(units: Amount): string {
  return `${formatChips(units)} ${units === UNITS_PER_CHIP ? 'fiche' : 'fiches'}`;
}

/** Signed amount with a real minus sign: "+12", "−3,50", "0". */
export function signedChips(units: Amount): string {
  if (units > 0) return `+${formatChips(units)}`;
  if (units < 0) return `−${formatChips(-units)}`;
  return '0';
}

/** Word describing the sign, for screen readers and colour-blind users. */
export function netTone(units: Amount): 'positive' | 'negative' | 'neutral' {
  if (units > 0) return 'positive';
  if (units < 0) return 'negative';
  return 'neutral';
}

export function unitsToChips(units: Amount): number {
  return units / UNITS_PER_CHIP;
}

export function chipsToUnits(chips: number): Amount {
  return Math.round(chips * UNITS_PER_CHIP);
}

const dateTimeFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const dateTimeLongFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormat.format(d);
}

export function formatDateTimeLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeLongFormat.format(d);
}

/** "1 h 05 min", "12 min", "45 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} s`;
}

export function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toLocaleString('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function pluralize(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('it-IT')} ${n === 1 ? singular : plural}`;
}
