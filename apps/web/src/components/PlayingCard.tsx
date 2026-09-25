import type { CSSProperties } from 'react';
import {
  SUIT_NAMES_IT,
  SUIT_SYMBOLS,
  cardRank,
  cardSuit,
  isRed,
  type CardCode,
} from '@casino/engine';

const RANK_NAMES_IT: Record<string, string> = {
  A: 'Asso',
  J: 'Fante',
  Q: 'Donna',
  K: 'Re',
};

/** "Asso di picche", "10 di cuori". */
export function cardName(code: CardCode): string {
  const rank = cardRank(code);
  return `${RANK_NAMES_IT[rank] ?? rank} di ${SUIT_NAMES_IT[cardSuit(code)]}`;
}

interface PlayingCardProps {
  /** null = face down. */
  code: CardCode | null;
  size?: 'md' | 'lg';
  /** Index for the deal-in animation stagger. */
  index?: number;
  className?: string;
}

/** CSS card: rank and suit in the corners, large suit in the middle; red suits also labelled. */
export function PlayingCard({ code, size = 'md', index = 0, className }: PlayingCardProps) {
  const style = { '--deal-index': index } as CSSProperties;
  if (code === null) {
    return (
      <div
        className={`card card-${size} card-back ${className ?? ''}`}
        role="img"
        aria-label="Carta coperta"
        style={style}
      >
        <span className="card-back-pattern" aria-hidden="true" />
      </div>
    );
  }
  const rank = cardRank(code);
  const suit = SUIT_SYMBOLS[cardSuit(code)];
  const red = isRed(code);
  return (
    <div
      className={`card card-${size} ${red ? 'card-red' : 'card-black'} ${className ?? ''}`}
      role="img"
      aria-label={cardName(code)}
      style={style}
    >
      <span className="card-corner card-corner-top" aria-hidden="true">
        <span className="card-rank">{rank}</span>
        <span className="card-suit">{suit}</span>
      </span>
      <span className="card-center" aria-hidden="true">
        {suit}
      </span>
      <span className="card-corner card-corner-bottom" aria-hidden="true">
        <span className="card-rank">{rank}</span>
        <span className="card-suit">{suit}</span>
      </span>
    </div>
  );
}
