import { rankIndex, type CardCode } from '../../cards.ts';

/** Blackjack points of a card with the ace counted as 1: A = 1, 2-9 face value, 10/J/Q/K = 10. */
export function cardPoints(code: CardCode): number {
  const rank = rankIndex(code);
  return rank >= 9 ? 10 : rank + 1;
}

/** Best total: one ace counts 11 when that does not bust ("soft"). */
export function computeHandValue(cards: readonly CardCode[]): { total: number; soft: boolean } {
  let total = 0;
  let hasAce = false;
  for (const code of cards) {
    const points = cardPoints(code);
    total += points;
    if (points === 1) hasAce = true;
  }
  if (hasAce && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Two-card A + 10-value. Callers decide whether the hand is eligible (non-split). */
export function isTwoCardTwentyOne(cards: readonly CardCode[]): boolean {
  return cards.length === 2 && computeHandValue(cards).total === 21;
}
