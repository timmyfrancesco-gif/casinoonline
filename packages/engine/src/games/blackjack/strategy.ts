/**
 * Basic strategy for 6 decks, dealer stands on soft 17, double after split allowed,
 * no surrender, one split per round. Chart decisions are resolved against the actions
 * actually allowed (e.g. "double else hit" becomes hit on a three-card hand).
 */
import { rankIndex, type CardCode } from '../../cards.ts';
import type { BlackjackAction } from './index.ts';
import { cardPoints, computeHandValue } from './values.ts';

/** Chart entry: H hit, S stand, D double (else hit), Ds double (else stand), P split. */
type ChartMove = 'H' | 'S' | 'D' | 'Ds' | 'P';

/** Dealer up-card value 2..11 (ace = 11). */
function upValue(code: CardCode): number {
  const points = cardPoints(code);
  return points === 1 ? 11 : points;
}

function hardMove(total: number, up: number): ChartMove {
  if (total >= 17) return 'S';
  if (total >= 13) return up <= 6 ? 'S' : 'H';
  if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
  if (total === 11) return up <= 10 ? 'D' : 'H';
  if (total === 10) return up <= 9 ? 'D' : 'H';
  if (total === 9) return up >= 3 && up <= 6 ? 'D' : 'H';
  return 'H';
}

function softMove(total: number, up: number): ChartMove {
  if (total >= 19) return 'S';
  if (total === 18) {
    if (up >= 3 && up <= 6) return 'Ds';
    return up <= 8 ? 'S' : 'H';
  }
  if (total === 17) return up >= 3 && up <= 6 ? 'D' : 'H';
  if (total >= 15) return up >= 4 && up <= 6 ? 'D' : 'H';
  if (total >= 13) return up >= 5 && up <= 6 ? 'D' : 'H';
  return 'H';
}

/** Whether a pair of the given points (ace = 1) should be split against the up-card. */
function splitPair(points: number, up: number): boolean {
  switch (points) {
    case 1:
    case 8:
      return true;
    case 9:
      return up !== 7 && up <= 9;
    case 7:
    case 3:
    case 2:
      return up <= 7;
    case 6:
      return up <= 6;
    case 4:
      return up === 5 || up === 6;
    default:
      return false; // 5-5 plays as hard 10, 10-10 stands
  }
}

export function basicStrategyAction(
  cards: readonly CardCode[],
  dealerUp: CardCode,
  allowed: readonly BlackjackAction[],
): BlackjackAction | null {
  if (allowed.length === 0 || cards.length === 0) return null;
  const up = upValue(dealerUp);
  const canSplit =
    allowed.includes('split') &&
    cards.length === 2 &&
    rankIndex(cards[0]!) === rankIndex(cards[1]!);
  let move: ChartMove;
  if (canSplit && splitPair(cardPoints(cards[0]!), up)) {
    move = 'P';
  } else {
    const { total, soft } = computeHandValue(cards);
    move = soft ? softMove(total, up) : hardMove(total, up);
  }
  const pick = (action: BlackjackAction, fallback: BlackjackAction): BlackjackAction =>
    allowed.includes(action) ? action : allowed.includes(fallback) ? fallback : allowed[0]!;
  switch (move) {
    case 'P':
      return 'split';
    case 'D':
      return pick('double', 'hit');
    case 'Ds':
      return pick('double', 'stand');
    case 'S':
      return pick('stand', 'hit');
    case 'H':
      return pick('hit', 'stand');
  }
}
