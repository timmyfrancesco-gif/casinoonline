/**
 * Allocation-free 5-card evaluator used by evaluatePokerHand and by the hold analysis
 * (millions of calls). Returns an index into POKER_HAND_RANKS; performs no validation.
 *
 * Ranks are tracked as a 13-bit mask (bit r = rank r, ace = bit 0): `seen` collects the
 * ranks, `dup` the ranks seen more than once. The number of distinct ranks plus the number
 * of duplicated ranks identifies every category without counting.
 */

export const RANK_ROYAL_FLUSH = 0;
export const RANK_STRAIGHT_FLUSH = 1;
export const RANK_FOUR_OF_A_KIND = 2;
export const RANK_FULL_HOUSE = 3;
export const RANK_FLUSH = 4;
export const RANK_STRAIGHT = 5;
export const RANK_THREE_OF_A_KIND = 6;
export const RANK_TWO_PAIR = 7;
export const RANK_JACKS_OR_BETTER = 8;
export const RANK_NOTHING = 9;

const RANK_BIT = new Int32Array(52);
const SUIT_OF = new Uint8Array(52);
for (let code = 0; code < 52; code++) {
  RANK_BIT[code] = 1 << (code % 13);
  SUIT_OF[code] = Math.floor(code / 13);
}

const POPCOUNT = new Uint8Array(1 << 13);
for (let mask = 1; mask < POPCOUNT.length; mask++)
  POPCOUNT[mask] = POPCOUNT[mask >> 1]! + (mask & 1);

/** 10-J-Q-K-A (ace is bit 0). */
const BROADWAY_MASK = 0b1_1110_0000_0001;
/** 0 = not a straight, 1 = straight, 2 = broadway. A-2-3-4-5 is bits 0..4. */
const STRAIGHT_KIND = new Uint8Array(1 << 13);
for (let low = 0; low <= 8; low++) STRAIGHT_KIND[0b11111 << low] = 1;
STRAIGHT_KIND[BROADWAY_MASK] = 2;

/** Pairs that pay: J, Q, K, A. */
const HIGH_PAIR_MASK = (1 << 0) | (1 << 10) | (1 << 11) | (1 << 12);

export function evaluateRankIndex(a: number, b: number, c: number, d: number, e: number): number {
  let seen = RANK_BIT[a]!;
  let dup = 0;
  let bit = RANK_BIT[b]!;
  dup |= seen & bit;
  seen |= bit;
  bit = RANK_BIT[c]!;
  dup |= seen & bit;
  seen |= bit;
  bit = RANK_BIT[d]!;
  dup |= seen & bit;
  seen |= bit;
  bit = RANK_BIT[e]!;
  dup |= seen & bit;
  seen |= bit;

  switch (POPCOUNT[seen]) {
    case 5: {
      const suit = SUIT_OF[a];
      const flush =
        SUIT_OF[b] === suit && SUIT_OF[c] === suit && SUIT_OF[d] === suit && SUIT_OF[e] === suit;
      const straight = STRAIGHT_KIND[seen]!;
      if (flush) {
        if (straight === 2) return RANK_ROYAL_FLUSH;
        return straight === 1 ? RANK_STRAIGHT_FLUSH : RANK_FLUSH;
      }
      return straight === 0 ? RANK_NOTHING : RANK_STRAIGHT;
    }
    case 4:
      return (dup & HIGH_PAIR_MASK) !== 0 ? RANK_JACKS_OR_BETTER : RANK_NOTHING;
    case 3:
      return POPCOUNT[dup] === 1 ? RANK_THREE_OF_A_KIND : RANK_TWO_PAIR;
    default:
      return POPCOUNT[dup] === 1 ? RANK_FOUR_OF_A_KIND : RANK_FULL_HOUSE;
  }
}
