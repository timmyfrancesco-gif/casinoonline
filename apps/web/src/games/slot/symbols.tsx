import type { SlotSymbol, SlotWinKind } from '@casino/engine';

export const SYMBOL_NAMES_IT: Record<SlotSymbol, string> = {
  SEVEN: 'Sette',
  BAR: 'Bar',
  BELL: 'Campana',
  CHERRY: 'Ciliegia',
  LEMON: 'Limone',
  ORANGE: 'Arancia',
};

export const WIN_NAMES_IT: Record<SlotWinKind, string> = {
  THREE_SEVEN: 'Tre sette',
  THREE_BAR: 'Tre bar',
  THREE_BELL: 'Tre campane',
  THREE_CHERRY: 'Tre ciliegie',
  THREE_LEMON: 'Tre limoni',
  THREE_ORANGE: 'Tre arance',
  TWO_CHERRY: 'Due ciliegie (in qualsiasi posizione)',
};

export const WIN_SYMBOLS: Record<SlotWinKind, SlotSymbol[]> = {
  THREE_SEVEN: ['SEVEN', 'SEVEN', 'SEVEN'],
  THREE_BAR: ['BAR', 'BAR', 'BAR'],
  THREE_BELL: ['BELL', 'BELL', 'BELL'],
  THREE_CHERRY: ['CHERRY', 'CHERRY', 'CHERRY'],
  THREE_LEMON: ['LEMON', 'LEMON', 'LEMON'],
  THREE_ORANGE: ['ORANGE', 'ORANGE', 'ORANGE'],
  TWO_CHERRY: ['CHERRY', 'CHERRY'],
};

/** Flat SVG fruit-machine symbols (decorative: names are given as text elsewhere). */
export function SlotSymbolIcon({ symbol, className }: { symbol: SlotSymbol; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`slot-symbol slot-symbol-${symbol.toLowerCase()} ${className ?? ''}`}
      aria-hidden="true"
      focusable="false"
    >
      {renderSymbol(symbol)}
    </svg>
  );
}

function renderSymbol(symbol: SlotSymbol) {
  switch (symbol) {
    case 'SEVEN':
      return (
        <>
          <path d="M16 14h32v8L34 52h-10l13-28H16z" className="sym-seven" />
          <path d="M16 14h32v8L34 52h-10l13-28H16z" className="sym-outline" />
        </>
      );
    case 'BAR':
      return (
        <>
          <rect x="8" y="20" width="48" height="24" rx="4" className="sym-bar" />
          <text x="32" y="37.5" textAnchor="middle" className="sym-bar-text">
            BAR
          </text>
        </>
      );
    case 'BELL':
      return (
        <>
          <path
            d="M32 10c-10 0-14 9-14 19v9l-6 7h40l-6-7v-9c0-10-4-19-14-19z"
            className="sym-bell"
          />
          <circle cx="32" cy="50" r="5" className="sym-bell-clapper" />
          <rect x="30" y="6" width="4" height="6" rx="2" className="sym-bell-clapper" />
        </>
      );
    case 'CHERRY':
      return (
        <>
          <path d="M22 40C24 26 32 16 44 10M42 42C40 28 42 18 44 10" className="sym-stem" />
          <path d="M44 10c4 2 10 2 12-2-4-3-9-3-12 2z" className="sym-leaf" />
          <circle cx="21" cy="44" r="11" className="sym-cherry" />
          <circle cx="42" cy="46" r="11" className="sym-cherry" />
          <circle cx="17" cy="40" r="3" className="sym-shine" />
          <circle cx="38" cy="42" r="3" className="sym-shine" />
        </>
      );
    case 'LEMON':
      return (
        <>
          <path
            d="M8 32c0-12 12-20 24-20s24 8 24 20-12 20-24 20S8 44 8 32z"
            className="sym-lemon"
          />
          <path d="M6 32l4-3v6zM58 32l-4-3v6z" className="sym-lemon" />
          <path d="M20 26c4-4 10-6 14-6" className="sym-shine-line" />
        </>
      );
    case 'ORANGE':
      return (
        <>
          <circle cx="32" cy="35" r="20" className="sym-orange" />
          <path d="M32 15c2-5 8-8 14-6-2 5-8 8-14 6z" className="sym-leaf" />
          <circle cx="25" cy="28" r="3" className="sym-shine" />
        </>
      );
  }
}
