import type { GameId } from '@casino/engine';
import { RED_NUMBERS, WHEEL_ORDER } from '@casino/engine';

/** Decorative illustrations for the lobby cards (aria-hidden). */
export function GameArt({ game }: { game: GameId }) {
  switch (game) {
    case 'roulette':
      return <RouletteArt />;
    case 'slot':
      return <SlotArt />;
    case 'blackjack':
      return <CardsArt ranks={['A', 'K']} suits={['♠', '♥']} />;
    case 'videopoker':
      return <CardsArt ranks={['J', 'J', '7', '4', '9']} suits={['♣', '♦', '♠', '♥', '♣']} />;
  }
}

function RouletteArt() {
  const n = WHEEL_ORDER.length;
  const r = 44;
  return (
    <svg viewBox="0 0 100 100" className="game-art" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="48" className="art-rim" />
      {WHEEL_ORDER.map((num, i) => {
        const a0 = ((i - 0.5) / n) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2;
        const d = `M50 50 L${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)} Z`;
        const cls =
          num === 0 ? 'pocket-green' : RED_NUMBERS.includes(num) ? 'pocket-red' : 'pocket-black';
        return <path key={num} d={d} className={cls} />;
      })}
      <circle cx="50" cy="50" r="24" className="art-hub" />
      <circle cx="50" cy="50" r="6" className="art-rim" />
      <circle cx="50" cy="12" r="3.2" className="art-ball" />
    </svg>
  );
}

function SlotArt() {
  return (
    <svg viewBox="0 0 120 80" className="game-art" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="112" height="68" rx="10" className="art-rim" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={12 + i * 34} y="14" width="28" height="52" rx="4" className="art-reel" />
        </g>
      ))}
      {/* cherry, lemon, bell */}
      <g transform="translate(26 40)">
        <path d="M-4 -2 C-2 -12 4 -14 8 -16 M4 0 C4 -8 6 -12 8 -16" className="art-stem" />
        <circle cx="-4" cy="3" r="5" className="sym-cherry" />
        <circle cx="5" cy="5" r="5" className="sym-cherry" />
      </g>
      <ellipse cx="60" cy="40" rx="10" ry="7" className="sym-lemon" />
      <g transform="translate(94 40)">
        <path d="M-9 6 C-9 -2 -7 -10 0 -10 C7 -10 9 -2 9 6 Z" className="sym-bell" />
        <circle cx="0" cy="8" r="2.5" className="sym-bell" />
      </g>
      <line x1="10" y1="40" x2="110" y2="40" className="art-payline" />
    </svg>
  );
}

function CardsArt({ ranks, suits }: { ranks: string[]; suits: string[] }) {
  const count = ranks.length;
  const width = 30;
  const spread = count > 2 ? 17 : 24;
  const total = width + spread * (count - 1);
  const start = (120 - total) / 2;
  return (
    <svg viewBox="0 0 120 80" className="game-art" aria-hidden="true" focusable="false">
      {ranks.map((rank, i) => {
        const suit = suits[i] ?? '♠';
        const red = suit === '♥' || suit === '♦';
        const x = start + i * spread;
        const rot = (i - (count - 1) / 2) * (count > 2 ? 6 : 10);
        return (
          <g key={i} transform={`rotate(${rot} ${x + width / 2} 70)`}>
            <rect x={x} y="14" width={width} height="44" rx="4" className="art-card" />
            <text
              x={x + 4}
              y="26"
              className={red ? 'art-card-red' : 'art-card-black'}
              fontSize="10"
            >
              {rank}
            </text>
            <text
              x={x + width / 2}
              y="44"
              textAnchor="middle"
              className={red ? 'art-card-red' : 'art-card-black'}
              fontSize="16"
            >
              {suit}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
