/**
 * Blackjack. CONTRACT FILE: exported names, types and semantics are relied upon by
 * the server (which stores BlackjackState as JSON) and the web app (public view).
 *
 * Rules
 * - 6 decks, reshuffled for EVERY round: shoe = shuffleInPlace(rng, orderedShoe(6)).
 *   (A fresh shoe per round makes each round independently verifiable and removes card counting.)
 * - Deal order: shoe[0] player, shoe[1] dealer up-card, shoe[2] player, shoe[3] dealer hole card.
 *   Further cards are drawn sequentially from shoe[next].
 * - Card values: A = 1 or 11, 2-9 face value, 10/J/Q/K = 10. "soft" = an ace counted as 11.
 * - Blackjack = A + 10-value card as the first two cards of a NON-split hand.
 * - Dealer peek: when the dealer has blackjack the round settles immediately after the deal
 *   (player blackjack pushes, otherwise the player loses the base bet only).
 *   When only the player has blackjack the round settles immediately paying 3:2 (returns bet * 5/2).
 * - Player actions on the active hand:
 *     hit    — draw a card; a total over 21 busts the hand; a total of exactly 21 auto-stands.
 *     stand  — end the hand.
 *     double — only on a hand's first two cards (also after a split): bet doubles, exactly one
 *              more card, then the hand ends. Costs an extra stake equal to the hand's bet.
 *     split  — only on the initial two-card hand with two cards of the same RANK (e.g. K-K, not K-Q),
 *              at most once per round (max 2 hands). Costs an extra stake equal to the bet.
 *              Each new hand receives one more card immediately (first the left hand, then the right).
 *              Split aces receive exactly one card each and are then done (no hit/double).
 *              A + 10-value on a split hand counts as 21, not blackjack.
 * - After the last hand ends: if every hand busted, the dealer only reveals the hole card.
 *   Otherwise the dealer draws while total < 17 and STANDS on all 17s including soft 17 (S17).
 * - Settlement per hand (payout = total returned, stake included):
 *     bust -> 0 | dealer bust -> 2*bet | higher -> 2*bet | equal -> bet | lower -> 0
 *     natural blackjack (non-split, dealer without blackjack) -> bet * 5 / 2
 * - No insurance, no surrender.
 * - Bets are whole chips (multiples of 100 units), so bet * 5 / 2 is always an integer.
 */
import type { Amount } from '../../money.ts';
import type { CardCode } from '../../cards.ts';
import type { Rng } from '../../fair/rng.ts';

export const BLACKJACK_DECKS = 6;
export const BLACKJACK_ACTIONS = ['hit', 'stand', 'double', 'split'] as const;
export type BlackjackAction = (typeof BLACKJACK_ACTIONS)[number];

export interface BlackjackHand {
  cards: CardCode[];
  /** Current stake on this hand (doubled hands carry 2x the base bet). */
  bet: Amount;
  doubled: boolean;
  fromSplit: boolean;
  /** True when no more actions are possible on this hand (stood, busted, 21, doubled, split aces). */
  done: boolean;
}

export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose';

export interface BlackjackHandResult {
  outcome: BlackjackOutcome;
  /** Total returned for this hand, stake included. */
  payout: Amount;
}

export interface BlackjackResult {
  hands: BlackjackHandResult[];
  dealerTotal: number;
  dealerBlackjack: boolean;
  dealerBusted: boolean;
  totalBet: Amount;
  totalPayout: Amount;
}

export type BlackjackPhase = 'player' | 'settled';

/** Full (secret) state. Must stay JSON-serialisable: plain objects, arrays, numbers, strings, booleans, null. */
export interface BlackjackState {
  baseBet: Amount;
  /** The whole shuffled shoe for this round. Secret while phase === 'player'. */
  shoe: CardCode[];
  /** Index in `shoe` of the next card to draw. */
  next: number;
  /** dealer[0] = up-card, dealer[1] = hole card (secret while phase === 'player'). */
  dealer: CardCode[];
  hands: BlackjackHand[];
  /** Index of the hand currently being played. */
  active: number;
  phase: BlackjackPhase;
  /** Number of player actions applied so far (optimistic concurrency token for the API). */
  step: number;
  /** Player actions applied so far, in order (used to replay/verify the round). */
  actions: BlackjackAction[];
  result: BlackjackResult | null;
}

export interface BlackjackPublicHand {
  cards: CardCode[];
  bet: Amount;
  doubled: boolean;
  fromSplit: boolean;
  done: boolean;
  total: number;
  soft: boolean;
  result: BlackjackHandResult | null;
}

/** What the client may see. Never contains the shoe; hides the hole card while playing. */
export interface BlackjackPublicState {
  phase: BlackjackPhase;
  step: number;
  active: number;
  hands: BlackjackPublicHand[];
  dealer: {
    /** null = face-down hole card. */
    cards: (CardCode | null)[];
    /** Total of the visible cards. */
    total: number;
    soft: boolean;
  };
  allowedActions: BlackjackAction[];
  totalBet: Amount;
  result: BlackjackResult | null;
}

export class IllegalBlackjackActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalBlackjackActionError';
  }
}

/** Best total for a set of cards: aces count 11 when that does not bust. */
export function handValue(cards: CardCode[]): { total: number; soft: boolean } {
  void cards;
  throw new Error('not implemented');
}

/** Shuffles a 6-deck shoe with rng, then deals. */
export function blackjackDeal(bet: Amount, rng: Rng): BlackjackState {
  void bet;
  void rng;
  throw new Error('not implemented');
}

/** Deals from a given shoe (tests use stacked shoes). May settle immediately (blackjacks). */
export function blackjackDealFromShoe(bet: Amount, shoe: CardCode[]): BlackjackState {
  void bet;
  void shoe;
  throw new Error('not implemented');
}

/** Legal actions for the active hand ([] when settled). */
export function blackjackAllowedActions(state: BlackjackState): BlackjackAction[] {
  void state;
  throw new Error('not implemented');
}

/** Extra stake an action requires (the server debits it before applying). 0 for hit/stand. */
export function blackjackActionCost(state: BlackjackState, action: BlackjackAction): Amount {
  void state;
  void action;
  throw new Error('not implemented');
}

/**
 * Pure transition: returns a NEW state (input not mutated). Increments step, appends to
 * actions, advances hands, runs the dealer and settles when the last hand ends.
 * Throws IllegalBlackjackActionError when the action is not allowed.
 */
export function blackjackApply(state: BlackjackState, action: BlackjackAction): BlackjackState {
  void state;
  void action;
  throw new Error('not implemented');
}

/** Sum of all stakes currently on the table (base bet + doubles + split). */
export function blackjackTotalStake(state: BlackjackState): Amount {
  void state;
  throw new Error('not implemented');
}

export function blackjackPublicView(state: BlackjackState): BlackjackPublicState {
  void state;
  throw new Error('not implemented');
}

/** Basic-strategy suggestion for the active hand (6D, S17, DAS, no surrender), restricted to allowed actions. */
export function blackjackBasicStrategy(
  state: BlackjackState | BlackjackPublicState,
): BlackjackAction | null {
  void state;
  throw new Error('not implemented');
}

/** Re-plays a round from its RNG and the recorded actions (verification). */
export function blackjackReplay(bet: Amount, rng: Rng, actions: BlackjackAction[]): BlackjackState {
  void bet;
  void rng;
  void actions;
  throw new Error('not implemented');
}
