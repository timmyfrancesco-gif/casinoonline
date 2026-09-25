import { formatChips, type Amount } from '@casino/engine';
import { netTone, signedChips } from '../lib/format.ts';

/** Signed net result: colour plus explicit sign and screen-reader wording. */
export function NetAmount({ value, suffix = true }: { value: Amount; suffix?: boolean }) {
  const tone = netTone(value);
  const sr = tone === 'positive' ? 'guadagno' : tone === 'negative' ? 'perdita' : 'pari';
  return (
    <span className={`net net-${tone}`}>
      <span className="visually-hidden">{sr} </span>
      {signedChips(value)}
      {suffix && <span className="net-unit"> fiches</span>}
    </span>
  );
}

export function Chips({ value }: { value: Amount }) {
  return <span className="chips-amount">{formatChips(value)}</span>;
}
