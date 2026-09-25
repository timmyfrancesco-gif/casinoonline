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
import { isCardCode, orderedShoe, rankIndex, type CardCode } from '../../cards.ts';
import { shuffleInPlace, type Rng } from '../../fair/rng.ts';
import { basicStrategyAction } from './strategy.ts';
import { cardPoints, computeHandValue, isTwoCardTwentyOne } from './values.ts';

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
  return computeHandValue(cards);
}

/** A + 10-value as the first two cards of a non-split hand. */
export function isNaturalBlackjack(hand: Pick<BlackjackHand, 'cards' | 'fromSplit'>): boolean {
  return !hand.fromSplit && isTwoCardTwentyOne(hand.cards);
}

function assertBet(bet: Amount): void {
  if (!Number.isSafeInteger(bet) || bet <= 0) {
    throw new RangeError(`Puntata non valida: ${bet}`);
  }
}

/** Returns a deep copy; the shoe is copied too so callers can never alias the input. */
function cloneState(state: BlackjackState): BlackjackState {
  return {
    baseBet: state.baseBet,
    shoe: state.shoe.slice(),
    next: state.next,
    dealer: state.dealer.slice(),
    hands: state.hands.map((hand) => ({ ...hand, cards: hand.cards.slice() })),
    active: state.active,
    phase: state.phase,
    step: state.step,
    actions: state.actions.slice(),
    result: state.result === null ? null : cloneResult(state.result),
  };
}

function cloneResult(result: BlackjackResult): BlackjackResult {
  return { ...result, hands: result.hands.map((hand) => ({ ...hand })) };
}

/** Draws shoe[next] (mutates the given working copy). */
function draw(state: BlackjackState): CardCode {
  const card = state.shoe[state.next];
  if (card === undefined) throw new Error('Sabot esaurito');
  state.next++;
  return card;
}

/** Deals a card to a hand of the working copy; 21 or more ends the hand. */
function dealTo(state: BlackjackState, hand: BlackjackHand): void {
  hand.cards.push(draw(state));
  if (computeHandValue(hand.cards).total >= 21) hand.done = true;
}

function sumBets(hands: readonly BlackjackHand[]): Amount {
  let total = 0;
  for (const hand of hands) total += hand.bet;
  return total;
}

/** Settles right after the deal when either side has a natural (dealer peek). */
function settleNaturals(state: BlackjackState): void {
  const hand = state.hands[0]!;
  const playerBj = isNaturalBlackjack(hand);
  const dealerBj = isTwoCardTwentyOne(state.dealer);
  if (!playerBj && !dealerBj) return;
  hand.done = true;
  let handResult: BlackjackHandResult;
  if (playerBj && dealerBj) handResult = { outcome: 'push', payout: hand.bet };
  else if (dealerBj) handResult = { outcome: 'lose', payout: 0 };
  else handResult = { outcome: 'blackjack', payout: Math.floor((hand.bet * 5) / 2) };
  state.phase = 'settled';
  state.result = {
    hands: [handResult],
    dealerTotal: computeHandValue(state.dealer).total,
    dealerBlackjack: dealerBj,
    dealerBusted: false,
    totalBet: hand.bet,
    totalPayout: handResult.payout,
  };
}

/** Dealer plays (unless every hand busted) and every hand is settled. */
function finishRound(state: BlackjackState): void {
  const allBusted = state.hands.every((hand) => computeHandValue(hand.cards).total > 21);
  if (!allBusted) {
    while (computeHandValue(state.dealer).total < 17) state.dealer.push(draw(state));
  }
  const dealerTotal = computeHandValue(state.dealer).total;
  const dealerBusted = dealerTotal > 21;
  const hands = state.hands.map((hand): BlackjackHandResult => {
    const total = computeHandValue(hand.cards).total;
    if (total > 21) return { outcome: 'lose', payout: 0 };
    if (dealerBusted || total > dealerTotal) return { outcome: 'win', payout: hand.bet * 2 };
    if (total === dealerTotal) return { outcome: 'push', payout: hand.bet };
    return { outcome: 'lose', payout: 0 };
  });
  state.phase = 'settled';
  state.active = state.hands.length - 1;
  state.result = {
    hands,
    dealerTotal,
    dealerBlackjack: false,
    dealerBusted,
    totalBet: sumBets(state.hands),
    totalPayout: hands.reduce((sum, hand) => sum + hand.payout, 0),
  };
}

/** Moves `active` to the next unfinished hand, or finishes the round. */
function advance(state: BlackjackState): void {
  while (state.active < state.hands.length && state.hands[state.active]!.done) state.active++;
  if (state.active >= state.hands.length) finishRound(state);
}

/** Shuffles a 6-deck shoe with rng, then deals. */
export function blackjackDeal(bet: Amount, rng: Rng): BlackjackState {
  assertBet(bet);
  return blackjackDealFromShoe(bet, shuffleInPlace(rng, orderedShoe(BLACKJACK_DECKS)));
}

/** Deals from a given shoe (tests use stacked shoes). May settle immediately (blackjacks). */
export function blackjackDealFromShoe(bet: Amount, shoe: CardCode[]): BlackjackState {
  assertBet(bet);
  if (!Array.isArray(shoe) || shoe.length < 4 || !shoe.every(isCardCode)) {
    throw new RangeError('Sabot non valido');
  }
  const state: BlackjackState = {
    baseBet: bet,
    shoe: shoe.slice(),
    next: 4,
    dealer: [shoe[1]!, shoe[3]!],
    hands: [{ cards: [shoe[0]!, shoe[2]!], bet, doubled: false, fromSplit: false, done: false }],
    active: 0,
    phase: 'player',
    step: 0,
    actions: [],
    result: null,
  };
  settleNaturals(state);
  return state;
}

/** Legal actions for the active hand ([] when settled). */
export function blackjackAllowedActions(state: BlackjackState): BlackjackAction[] {
  if (state.phase !== 'player') return [];
  const hand = state.hands[state.active];
  if (hand === undefined || hand.done) return [];
  const actions: BlackjackAction[] = ['hit', 'stand'];
  if (hand.cards.length === 2) {
    actions.push('double');
    if (
      state.hands.length === 1 &&
      !hand.fromSplit &&
      rankIndex(hand.cards[0]!) === rankIndex(hand.cards[1]!)
    ) {
      actions.push('split');
    }
  }
  return actions;
}

/**
 * Extra stake an action requires (the server debits it before applying). 0 for hit/stand.
 * double costs the active hand's bet, split costs the base bet; 0 when the round is settled.
 * It does not check legality: blackjackApply does.
 */
export function blackjackActionCost(state: BlackjackState, action: BlackjackAction): Amount {
  if (state.phase !== 'player') return 0;
  if (action === 'double') return state.hands[state.active]?.bet ?? 0;
  if (action === 'split') return state.baseBet;
  return 0;
}

const ACTION_NAMES_IT: Record<BlackjackAction, string> = {
  hit: 'carta',
  stand: 'stai',
  double: 'raddoppio',
  split: 'dividi',
};

function illegalMessage(state: BlackjackState, action: unknown): string {
  if (state.phase !== 'player') return 'La mano è già conclusa.';
  if (typeof action !== 'string' || !(BLACKJACK_ACTIONS as readonly string[]).includes(action)) {
    return 'Azione sconosciuta.';
  }
  const hand = state.hands[state.active];
  if (action === 'double') return 'Puoi raddoppiare solo sulle prime due carte della mano.';
  if (action === 'split') {
    if (state.hands.length > 1 || hand?.fromSplit) return 'Puoi dividere una sola volta per mano.';
    return 'Puoi dividere solo due carte dello stesso valore nominale.';
  }
  return `Azione "${ACTION_NAMES_IT[action as BlackjackAction]}" non consentita.`;
}

/**
 * Pure transition: returns a NEW state (input not mutated). Increments step, appends to
 * actions, advances hands, runs the dealer and settles when the last hand ends.
 * Throws IllegalBlackjackActionError when the action is not allowed.
 */
export function blackjackApply(state: BlackjackState, action: BlackjackAction): BlackjackState {
  if (!blackjackAllowedActions(state).includes(action)) {
    throw new IllegalBlackjackActionError(illegalMessage(state, action));
  }
  const next = cloneState(state);
  next.step++;
  next.actions.push(action);
  const hand = next.hands[next.active]!;
  switch (action) {
    case 'hit':
      dealTo(next, hand);
      break;
    case 'stand':
      hand.done = true;
      break;
    case 'double':
      hand.bet *= 2;
      hand.doubled = true;
      dealTo(next, hand);
      hand.done = true;
      break;
    case 'split': {
      const [left, right] = hand.cards as [CardCode, CardCode];
      const newHand = (card: CardCode): BlackjackHand => ({
        cards: [card],
        bet: hand.bet,
        doubled: false,
        fromSplit: true,
        done: false,
      });
      next.hands = [newHand(left), newHand(right)];
      for (const splitHand of next.hands) dealTo(next, splitHand);
      if (cardPoints(left) === 1) {
        for (const splitHand of next.hands) splitHand.done = true;
      }
      next.active = 0;
      break;
    }
  }
  advance(next);
  return next;
}

/** Sum of all stakes currently on the table (base bet + doubles + split). */
export function blackjackTotalStake(state: BlackjackState): Amount {
  return sumBets(state.hands);
}

export function blackjackPublicView(state: BlackjackState): BlackjackPublicState {
  const playing = state.phase === 'player';
  const visibleDealer = playing ? state.dealer.slice(0, 1) : state.dealer.slice();
  const dealerValue = computeHandValue(visibleDealer);
  return {
    phase: state.phase,
    step: state.step,
    active: state.active,
    hands: state.hands.map((hand, i) => {
      const value = computeHandValue(hand.cards);
      const result = state.result?.hands[i];
      return {
        cards: hand.cards.slice(),
        bet: hand.bet,
        doubled: hand.doubled,
        fromSplit: hand.fromSplit,
        done: hand.done,
        total: value.total,
        soft: value.soft,
        result: result === undefined ? null : { ...result },
      };
    }),
    dealer: {
      cards: playing ? [...visibleDealer, ...state.dealer.slice(1).map(() => null)] : visibleDealer,
      total: dealerValue.total,
      soft: dealerValue.soft,
    },
    allowedActions: blackjackAllowedActions(state),
    totalBet: blackjackTotalStake(state),
    result: state.result === null ? null : cloneResult(state.result),
  };
}

function isPublicState(
  state: BlackjackState | BlackjackPublicState,
): state is BlackjackPublicState {
  return 'allowedActions' in state;
}

/** Basic-strategy suggestion for the active hand (6D, S17, DAS, no surrender), restricted to allowed actions. */
export function blackjackBasicStrategy(
  state: BlackjackState | BlackjackPublicState,
): BlackjackAction | null {
  if (state.phase !== 'player') return null;
  const hand = state.hands[state.active];
  const dealerUp = isPublicState(state) ? state.dealer.cards[0] : state.dealer[0];
  if (hand === undefined || dealerUp === undefined || dealerUp === null) return null;
  const allowed = isPublicState(state) ? state.allowedActions : blackjackAllowedActions(state);
  return basicStrategyAction(hand.cards, dealerUp, allowed);
}

/** Re-plays a round from its RNG and the recorded actions (verification). */
export function blackjackReplay(bet: Amount, rng: Rng, actions: BlackjackAction[]): BlackjackState {
  let state = blackjackDeal(bet, rng);
  for (const action of actions) state = blackjackApply(state, action);
  return state;
}
