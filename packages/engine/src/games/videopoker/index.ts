/**
 * Video Poker "Jacks or Better" 9/6. CONTRACT FILE: exported names, types and semantics
 * are relied upon by the server (stores VideoPokerState as JSON) and the web app.
 *
 * Rules
 * - One 52-card deck shuffled per round: deck = shuffleInPlace(rng, orderedShoe(1)).
 * - Deal: hand = deck[0..4].
 * - Draw: the player holds any subset of the 5 cards (held[i] === true keeps card i).
 *   Non-held positions are replaced left-to-right with deck[5], deck[6], ... in order.
 * - Paytable (total return as a multiple of the bet, stake included):
 *     ROYAL_FLUSH 800 | STRAIGHT_FLUSH 50 | FOUR_OF_A_KIND 25 | FULL_HOUSE 9 | FLUSH 6
 *     STRAIGHT 4 | THREE_OF_A_KIND 3 | TWO_PAIR 2 | JACKS_OR_BETTER (pair of J, Q, K or A) 1
 *     anything else 0
 *   With optimal strategy the long-run return is 99.54% (well known value for 9/6 JoB with
 *   the 800x royal); it requires perfect play, so the UI must present it as such.
 * - Straights: A-2-3-4-5 (wheel) and 10-J-Q-K-A count; no wrap-around (Q-K-A-2-3 is not).
 *   ROYAL_FLUSH = 10-J-Q-K-A suited. STRAIGHT_FLUSH excludes the royal.
 */
import type { Amount } from '../../money.ts';
import type { CardCode } from '../../cards.ts';
import type { Rng } from '../../fair/rng.ts';

export const POKER_HAND_RANKS = [
  'ROYAL_FLUSH',
  'STRAIGHT_FLUSH',
  'FOUR_OF_A_KIND',
  'FULL_HOUSE',
  'FLUSH',
  'STRAIGHT',
  'THREE_OF_A_KIND',
  'TWO_PAIR',
  'JACKS_OR_BETTER',
  'NOTHING',
] as const;
export type PokerHandRank = (typeof POKER_HAND_RANKS)[number];

export const VIDEO_POKER_PAYTABLE: Record<PokerHandRank, number> = {
  ROYAL_FLUSH: 800,
  STRAIGHT_FLUSH: 50,
  FOUR_OF_A_KIND: 25,
  FULL_HOUSE: 9,
  FLUSH: 6,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR: 2,
  JACKS_OR_BETTER: 1,
  NOTHING: 0,
};

export const VIDEO_POKER_HAND_NAMES_IT: Record<PokerHandRank, string> = {
  ROYAL_FLUSH: 'Scala reale massima',
  STRAIGHT_FLUSH: 'Scala colore',
  FOUR_OF_A_KIND: 'Poker',
  FULL_HOUSE: 'Full',
  FLUSH: 'Colore',
  STRAIGHT: 'Scala',
  THREE_OF_A_KIND: 'Tris',
  TWO_PAIR: 'Doppia coppia',
  JACKS_OR_BETTER: 'Coppia di J o superiore',
  NOTHING: 'Niente',
};

/** Documented long-run return with optimal play. */
export const VIDEO_POKER_OPTIMAL_RTP = 0.9954;

export type VideoPokerPhase = 'hold' | 'settled';

export interface VideoPokerResult {
  rank: PokerHandRank;
  multiplier: number;
  /** Total returned, stake included. */
  payout: Amount;
}

/** Full (secret) state; JSON-serialisable. */
export interface VideoPokerState {
  bet: Amount;
  /** Whole shuffled deck for the round. Secret while phase === 'hold'. */
  deck: CardCode[];
  /** Current 5 cards (initial deal while holding, final hand once settled). */
  hand: CardCode[];
  /** Hold mask chosen at draw time; null before the draw. */
  held: boolean[] | null;
  phase: VideoPokerPhase;
  step: number;
  result: VideoPokerResult | null;
}

export interface VideoPokerPublicState {
  bet: Amount;
  phase: VideoPokerPhase;
  step: number;
  /** Initial deal when holding; after settlement, the final hand. */
  hand: CardCode[];
  /** The original five dealt cards (useful to animate replacements). */
  dealt: CardCode[];
  held: boolean[] | null;
  /** Rank of the current 5 cards (for the "you have ..." hint while holding). */
  currentRank: PokerHandRank;
  result: VideoPokerResult | null;
}

export class IllegalVideoPokerActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalVideoPokerActionError';
  }
}

/** Evaluates exactly 5 distinct cards. */
export function evaluatePokerHand(cards: CardCode[]): PokerHandRank {
  void cards;
  throw new Error('not implemented');
}

export function videoPokerDeal(bet: Amount, rng: Rng): VideoPokerState {
  void bet;
  void rng;
  throw new Error('not implemented');
}

/** Deals from a given 52-card deck order (tests). */
export function videoPokerDealFromDeck(bet: Amount, deck: CardCode[]): VideoPokerState {
  void bet;
  void deck;
  throw new Error('not implemented');
}

/** Pure: returns the settled state. held must have length 5. Throws IllegalVideoPokerActionError if not in 'hold' phase. */
export function videoPokerDraw(state: VideoPokerState, held: boolean[]): VideoPokerState {
  void state;
  void held;
  throw new Error('not implemented');
}

export function videoPokerPublicView(state: VideoPokerState): VideoPokerPublicState {
  void state;
  throw new Error('not implemented');
}

/** Re-plays a round from its RNG and the hold mask (verification). */
export function videoPokerReplay(bet: Amount, rng: Rng, held: boolean[]): VideoPokerState {
  void bet;
  void rng;
  void held;
  throw new Error('not implemented');
}

/**
 * Exact expected return (multiple of the bet) for every one of the 32 hold masks of a
 * 5-card hand, using the remaining 47 cards. Returns masks sorted by EV descending.
 * Used for the optional "suggerimento" and must run in the browser in well under 2 s.
 */
export function videoPokerHoldAnalysis(hand: CardCode[]): { held: boolean[]; ev: number }[] {
  void hand;
  throw new Error('not implemented');
}
