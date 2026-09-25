import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CardCode } from '../src/cards.ts';
import { createRoundRng, createSeededTestRng } from '../src/fair/rng.ts';
import {
  BLACKJACK_DECKS,
  IllegalBlackjackActionError,
  blackjackActionCost,
  blackjackAllowedActions,
  blackjackApply,
  blackjackBasicStrategy,
  blackjackDeal,
  blackjackDealFromShoe,
  blackjackPublicView,
  blackjackReplay,
  blackjackTotalStake,
  handValue,
  type BlackjackAction,
  type BlackjackState,
} from '../src/games/blackjack/index.ts';

const RANK_INDEX: Record<string, number> = {
  A: 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  '10': 9,
  J: 10,
  Q: 11,
  K: 12,
};

/** Card by rank label; suit varies so repeated ranks are distinct codes. */
const card = (label: string, suit = 0): CardCode => RANK_INDEX[label]! + 13 * suit;
const cards = (...labels: string[]): CardCode[] => labels.map((l, i) => card(l, i % 4));

/**
 * Stacked shoe in deal order: player 1st card, dealer up-card, player 2nd card, dealer hole
 * card, then the cards drawn afterwards. The shoe holds nothing else, so an unexpected draw
 * throws ("Sabot esaurito").
 */
function stacked(player: [string, string], dealer: [string, string], ...draws: string[]) {
  return cards(player[0], dealer[0], player[1], dealer[1], ...draws);
}

const BET = 1000;

function deal(player: [string, string], dealer: [string, string], ...draws: string[]) {
  return blackjackDealFromShoe(BET, stacked(player, dealer, ...draws));
}

function play(state: BlackjackState, ...actions: BlackjackAction[]): BlackjackState {
  return actions.reduce(blackjackApply, state);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('handValue', () => {
  it.each([
    [[], 0, false],
    [['K', 'Q'], 20, false],
    [['A', 'K'], 21, true],
    [['A', '6'], 17, true],
    [['A', '6', '10'], 17, false],
    [['A', 'A'], 12, true],
    [['A', 'A', '9'], 21, true],
    [['A', 'A', 'A', 'A'], 14, true],
    [['A', 'A', 'A', 'A', '7'], 21, true],
    [['A', 'A', 'A', 'A', '8'], 12, false],
    [['5', '6', 'J'], 21, false],
    [['10', '6', 'K'], 26, false],
    [['A', '5', '5'], 21, true],
    [['A', '9', 'A'], 21, true],
  ] as [string[], number, boolean][])('%j -> %i (soft %s)', (labels, total, soft) => {
    expect(handValue(cards(...labels))).toEqual({ total, soft });
  });
});

describe('deal and naturals (dealer peek)', () => {
  it('deals shoe[0], shoe[2] to the player and shoe[1], shoe[3] to the dealer', () => {
    const shoe = stacked(['9', '7'], ['10', '8']);
    const state = blackjackDealFromShoe(BET, shoe);
    expect(state.hands[0]!.cards).toEqual([shoe[0], shoe[2]]);
    expect(state.dealer).toEqual([shoe[1], shoe[3]]);
    expect(state.next).toBe(4);
    expect(state.phase).toBe('player');
    expect(state.step).toBe(0);
    expect(state.actions).toEqual([]);
    expect(state.result).toBeNull();
    expect(blackjackAllowedActions(state)).toEqual(['hit', 'stand', 'double']);
  });

  it('player natural pays 3:2 at the deal', () => {
    const state = deal(['A', 'K'], ['9', '7']);
    expect(state.phase).toBe('settled');
    expect(state.step).toBe(0);
    expect(state.hands[0]!.done).toBe(true);
    expect(state.result).toEqual({
      hands: [{ outcome: 'blackjack', payout: 2500 }],
      dealerTotal: 16,
      dealerBlackjack: false,
      dealerBusted: false,
      totalBet: 1000,
      totalPayout: 2500,
    });
    expect(state.dealer).toHaveLength(2);
    expect(blackjackAllowedActions(state)).toEqual([]);
  });

  it('dealer natural (ace up) settles at the deal: the player loses the base bet only', () => {
    const state = deal(['10', '9'], ['A', 'Q']);
    expect(state.phase).toBe('settled');
    expect(state.result).toMatchObject({
      hands: [{ outcome: 'lose', payout: 0 }],
      dealerTotal: 21,
      dealerBlackjack: true,
      totalBet: 1000,
      totalPayout: 0,
    });
  });

  it('dealer natural with a ten up (peek) also settles at the deal', () => {
    const state = deal(['8', '8'], ['K', 'A']);
    expect(state.phase).toBe('settled');
    expect(state.result!.dealerBlackjack).toBe(true);
    expect(state.result!.totalPayout).toBe(0);
    expect(() => blackjackApply(state, 'split')).toThrow(IllegalBlackjackActionError);
    const view = blackjackPublicView(state);
    expect(view.dealer.cards).toEqual([card('K', 1), card('A', 3)]);
    expect(view.dealer.total).toBe(21);
  });

  it('both naturals push', () => {
    const state = deal(['A', 'J'], ['K', 'A']);
    expect(state.phase).toBe('settled');
    expect(state.result).toMatchObject({
      hands: [{ outcome: 'push', payout: 1000 }],
      dealerBlackjack: true,
      totalPayout: 1000,
    });
  });

  it('an ace up without blackjack continues (no insurance)', () => {
    const state = deal(['10', '6'], ['A', '9']);
    expect(state.phase).toBe('player');
    const view = blackjackPublicView(state);
    expect(view.dealer.cards).toEqual([card('A', 1), null]);
    expect(view.dealer.total).toBe(11);
    expect(view.dealer.soft).toBe(true);
  });

  it('rejects bad bets and shoes', () => {
    expect(() => blackjackDealFromShoe(0, stacked(['9', '7'], ['10', '8']))).toThrow(RangeError);
    expect(() => blackjackDealFromShoe(10.5, stacked(['9', '7'], ['10', '8']))).toThrow(RangeError);
    expect(() => blackjackDealFromShoe(BET, [1, 2, 3])).toThrow(RangeError);
    expect(() => blackjackDealFromShoe(BET, [1, 2, 3, 52])).toThrow(RangeError);
  });
});

describe('player actions', () => {
  it('hit to bust: the dealer does not draw', () => {
    const state = play(deal(['10', '6'], ['10', '5'], 'K'), 'hit');
    expect(state.phase).toBe('settled');
    expect(state.hands[0]!.cards).toHaveLength(3);
    expect(state.dealer).toHaveLength(2);
    expect(state.result).toMatchObject({
      hands: [{ outcome: 'lose', payout: 0 }],
      dealerTotal: 15,
      dealerBusted: false,
      totalPayout: 0,
    });
  });

  it('a total of exactly 21 auto-stands', () => {
    const state = play(deal(['5', '6'], ['10', '7'], 'K'), 'hit');
    expect(state.hands[0]!.done).toBe(true);
    expect(state.phase).toBe('settled');
    expect(state.result!.hands[0]).toEqual({ outcome: 'win', payout: 2000 });
    const soft = play(deal(['A', '5'], ['10', '7'], '5'), 'hit');
    expect(soft.phase).toBe('settled');
    expect(handValue(soft.hands[0]!.cards)).toEqual({ total: 21, soft: true });
  });

  it('several hits keep the hand open below 21', () => {
    const state = play(deal(['2', '3'], ['10', '7'], '2', '2', '3'), 'hit', 'hit', 'hit');
    expect(state.phase).toBe('player');
    expect(handValue(state.hands[0]!.cards).total).toBe(12);
    expect(blackjackAllowedActions(state)).toEqual(['hit', 'stand']);
  });

  it('double: one card only, bet doubled, costs the hand bet', () => {
    const start = deal(['5', '6'], ['6', '10'], '2', '9');
    expect(blackjackActionCost(start, 'double')).toBe(BET);
    expect(blackjackActionCost(start, 'hit')).toBe(0);
    expect(blackjackActionCost(start, 'stand')).toBe(0);
    const state = blackjackApply(start, 'double');
    const hand = state.hands[0]!;
    expect(hand.cards).toHaveLength(3);
    expect(handValue(hand.cards).total).toBe(13);
    expect(hand.doubled).toBe(true);
    expect(hand.done).toBe(true);
    expect(hand.bet).toBe(2 * BET);
    expect(blackjackTotalStake(state)).toBe(2 * BET);
    // Dealer 16 draws the 9 and busts.
    expect(state.result).toMatchObject({
      hands: [{ outcome: 'win', payout: 4 * BET }],
      dealerTotal: 25,
      dealerBusted: true,
      totalBet: 2 * BET,
      totalPayout: 4 * BET,
    });
  });

  it('double is only allowed on the first two cards', () => {
    const state = play(deal(['2', '3'], ['10', '7'], '4'), 'hit');
    expect(blackjackAllowedActions(state)).toEqual(['hit', 'stand']);
    expect(() => blackjackApply(state, 'double')).toThrow(IllegalBlackjackActionError);
  });

  it('split only on two cards of the same rank (K-Q is not splittable)', () => {
    expect(blackjackAllowedActions(deal(['K', 'Q'], ['10', '7']))).not.toContain('split');
    expect(() => blackjackApply(deal(['K', 'Q'], ['10', '7']), 'split')).toThrow(
      IllegalBlackjackActionError,
    );
    expect(blackjackAllowedActions(deal(['K', 'K'], ['10', '7']))).toContain('split');
    expect(blackjackAllowedActions(deal(['8', '8'], ['10', '7']))).toEqual([
      'hit',
      'stand',
      'double',
      'split',
    ]);
  });

  it('split deals one card to each hand (left first) and allows double after split', () => {
    const start = deal(['8', '8'], ['10', '7'], '3', '10', '10');
    expect(blackjackActionCost(start, 'split')).toBe(BET);
    const split = blackjackApply(start, 'split');
    expect(split.phase).toBe('player');
    expect(split.hands).toHaveLength(2);
    expect(split.hands.map((h) => h.cards)).toEqual([
      [card('8', 0), card('3', 0)],
      [card('8', 2), card('10', 1)],
    ]);
    expect(split.hands.every((h) => h.fromSplit && h.bet === BET && !h.done)).toBe(true);
    expect(split.active).toBe(0);
    expect(blackjackTotalStake(split)).toBe(2 * BET);
    expect(blackjackAllowedActions(split)).toEqual(['hit', 'stand', 'double']);

    const doubled = blackjackApply(split, 'double');
    expect(doubled.hands[0]!.bet).toBe(2 * BET);
    expect(handValue(doubled.hands[0]!.cards).total).toBe(21);
    expect(doubled.active).toBe(1);
    expect(blackjackTotalStake(doubled)).toBe(3 * BET);

    const done = blackjackApply(doubled, 'stand');
    expect(done.phase).toBe('settled');
    expect(done.result).toEqual({
      hands: [
        { outcome: 'win', payout: 4 * BET },
        { outcome: 'win', payout: 2 * BET },
      ],
      dealerTotal: 17,
      dealerBlackjack: false,
      dealerBusted: false,
      totalBet: 3 * BET,
      totalPayout: 6 * BET,
    });
    expect(done.step).toBe(3);
    expect(done.actions).toEqual(['split', 'double', 'stand']);
  });

  it('only one split per round', () => {
    const split = blackjackApply(deal(['8', '8'], ['10', '7'], '8', '8'), 'split');
    expect(split.hands[0]!.cards.map((c) => c % 13)).toEqual([7, 7]);
    expect(blackjackAllowedActions(split)).not.toContain('split');
    expect(() => blackjackApply(split, 'split')).toThrow(IllegalBlackjackActionError);
  });

  it('split aces get one card each, then the round ends; A+10 counts 21, not blackjack', () => {
    const state = blackjackApply(deal(['A', 'A'], ['10', '7'], 'K', '5'), 'split');
    expect(state.phase).toBe('settled');
    expect(state.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(state.hands.every((h) => h.done && h.fromSplit)).toBe(true);
    expect(state.result!.hands).toEqual([
      { outcome: 'win', payout: 2 * BET },
      { outcome: 'lose', payout: 0 },
    ]);
    expect(state.result!.totalBet).toBe(2 * BET);
    expect(state.step).toBe(1);
  });

  it('a split hand reaching 21 on its second card auto-stands and play moves on', () => {
    const state = blackjackApply(deal(['K', 'K'], ['10', '7'], 'A', '5'), 'split');
    expect(state.hands[0]!.done).toBe(true);
    expect(state.active).toBe(1);
    expect(state.phase).toBe('player');
    const done = blackjackApply(state, 'stand');
    expect(done.result!.hands[0]).toEqual({ outcome: 'win', payout: 2 * BET });
  });

  it('when every hand busts the dealer does not draw', () => {
    // Dealer 16 would have to draw, but the shoe has no card left: drawing would throw.
    const start = deal(['8', '8'], ['10', '6'], '5', '6', '10', '10');
    const state = play(start, 'split', 'hit', 'hit');
    expect(state.phase).toBe('settled');
    expect(state.next).toBe(state.shoe.length);
    expect(state.dealer).toHaveLength(2);
    expect(state.result).toMatchObject({
      hands: [
        { outcome: 'lose', payout: 0 },
        { outcome: 'lose', payout: 0 },
      ],
      dealerTotal: 16,
      dealerBusted: false,
      totalBet: 2 * BET,
      totalPayout: 0,
    });
  });

  it('with one hand alive the dealer plays', () => {
    const state = play(deal(['8', '8'], ['10', '6'], '5', '10', '10', '4'), 'split', 'hit');
    expect(state.phase).toBe('player'); // left busted, right (18) still to play
    const done = blackjackApply(state, 'stand');
    expect(done.dealer).toHaveLength(3);
    expect(done.result!.dealerTotal).toBe(20);
    expect(done.result!.hands.map((h) => h.outcome)).toEqual(['lose', 'lose']);
  });
});

describe('dealer rules', () => {
  it('stands on soft 17', () => {
    const state = blackjackApply(deal(['10', '8'], ['A', '6']), 'stand');
    expect(state.dealer).toHaveLength(2);
    expect(state.result).toMatchObject({
      dealerTotal: 17,
      hands: [{ outcome: 'win', payout: 2 * BET }],
    });
  });

  it('draws on soft 16 and on hard 16', () => {
    const soft = blackjackApply(deal(['10', '8'], ['A', '5'], '2'), 'stand');
    expect(soft.result!.dealerTotal).toBe(18);
    expect(soft.result!.hands[0]!.outcome).toBe('push');
    const hard = blackjackApply(deal(['10', '9'], ['10', '6'], '5'), 'stand');
    expect(hard.dealer).toHaveLength(3);
    expect(hard.result).toMatchObject({ dealerTotal: 21, hands: [{ outcome: 'lose' }] });
  });

  it('keeps drawing until 17 or more, soft totals included', () => {
    const state = blackjackApply(deal(['10', '7'], ['2', '3'], 'A', '2', '4'), 'stand');
    // 2+3 = 5, +A = soft 16, +2 = soft 18 -> stands; the 4 is never drawn.
    expect(state.dealer).toHaveLength(4);
    expect(state.next).toBe(6);
    expect(state.result!.dealerTotal).toBe(18);
  });

  it('push returns the bet; dealer bust pays even money', () => {
    const push = blackjackApply(deal(['10', '8'], ['10', '8']), 'stand');
    expect(push.result!.hands[0]).toEqual({ outcome: 'push', payout: BET });
    const bust = blackjackApply(deal(['10', '2'], ['10', '6'], '10'), 'stand');
    expect(bust.result).toMatchObject({
      dealerBusted: true,
      dealerTotal: 26,
      hands: [{ outcome: 'win', payout: 2 * BET }],
    });
  });

  it('a lower total loses', () => {
    const state = blackjackApply(deal(['10', '7'], ['10', '8']), 'stand');
    expect(state.result!.hands[0]).toEqual({ outcome: 'lose', payout: 0 });
  });
});

describe('IllegalBlackjackActionError', () => {
  it('rejects actions after settlement, unknown actions and illegal moves', () => {
    const settled = deal(['A', 'K'], ['9', '7']);
    expect(() => blackjackApply(settled, 'hit')).toThrow(IllegalBlackjackActionError);
    const open = deal(['9', '7'], ['10', '8']);
    expect(() => blackjackApply(open, 'surrender' as BlackjackAction)).toThrow(
      IllegalBlackjackActionError,
    );
    expect(() => blackjackApply(open, 'split')).toThrow(IllegalBlackjackActionError);
    try {
      blackjackApply(open, 'split');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalBlackjackActionError);
      expect((error as Error).name).toBe('IllegalBlackjackActionError');
      expect((error as Error).message).toMatch(/dividere/);
    }
  });

  it('cost is 0 once the round is settled', () => {
    expect(blackjackActionCost(deal(['A', 'K'], ['9', '7']), 'double')).toBe(0);
  });
});

describe('purity and bookkeeping', () => {
  it('never mutates the input state', () => {
    const start = deepFreeze(deal(['8', '8'], ['10', '6'], '3', '10', '10', '5'));
    const snapshot = structuredClone(start);
    const split = deepFreeze(blackjackApply(start, 'split'));
    const doubled = deepFreeze(blackjackApply(split, 'double'));
    blackjackApply(doubled, 'stand');
    expect(start).toEqual(snapshot);
  });

  it('step and actions track every applied action', () => {
    let state = deal(['2', '3'], ['10', '7'], '2', '2', '9');
    const applied: BlackjackAction[] = [];
    for (const action of ['hit', 'hit', 'stand'] as BlackjackAction[]) {
      const before = state.step;
      state = blackjackApply(state, action);
      applied.push(action);
      expect(state.step).toBe(before + 1);
      expect(state.actions).toEqual(applied);
    }
    expect(state.phase).toBe('settled');
  });

  it('state survives a JSON round trip', () => {
    const state = play(deal(['8', '8'], ['10', '6'], '3', '10', '10', '5'), 'split', 'double');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('blackjackPublicView', () => {
  it('hides the shoe and the hole card while playing', () => {
    const state = deal(['10', '6'], ['9', 'K']);
    const view = blackjackPublicView(state);
    expect(view).not.toHaveProperty('shoe');
    expect(view).not.toHaveProperty('next');
    expect(JSON.stringify(view)).not.toContain('shoe');
    expect(view.dealer.cards).toEqual([card('9', 1), null]);
    expect(view.dealer.total).toBe(9);
    expect(view.dealer.soft).toBe(false);
    expect(view.hands[0]).toMatchObject({ total: 16, soft: false, result: null, bet: BET });
    expect(view.allowedActions).toEqual(['hit', 'stand', 'double']);
    expect(view.totalBet).toBe(BET);
    expect(view.phase).toBe('player');
    expect(view.result).toBeNull();
  });

  it('reveals every dealer card once settled', () => {
    const state = blackjackApply(deal(['10', '6'], ['9', '5'], '4'), 'stand');
    const view = blackjackPublicView(state);
    expect(view.dealer.cards).toEqual(state.dealer);
    expect(view.dealer.total).toBe(18);
    expect(view.allowedActions).toEqual([]);
    expect(view.hands[0]!.result).toEqual({ outcome: 'lose', payout: 0 });
    expect(view.result).toEqual(state.result);
  });

  it('does not alias the state', () => {
    const state = deal(['10', '6'], ['9', '5']);
    const view = blackjackPublicView(state);
    view.hands[0]!.cards.push(3);
    expect(state.hands[0]!.cards).toHaveLength(2);
  });
});

describe('blackjackBasicStrategy', () => {
  const cases: [[string, string], [string, string], BlackjackAction][] = [
    [['10', '6'], ['10', '7'], 'hit'], // hard 16 vs 10
    [['10', '6'], ['6', '7'], 'stand'], // hard 16 vs 6
    [['10', '2'], ['4', '7'], 'stand'], // hard 12 vs 4
    [['10', '2'], ['3', '7'], 'hit'], // hard 12 vs 3
    [['6', '5'], ['6', '7'], 'double'], // 11 vs 6
    [['6', '5'], ['A', '7'], 'hit'], // 11 vs A (S17)
    [['6', '4'], ['9', '7'], 'double'], // 10 vs 9
    [['6', '4'], ['10', '7'], 'hit'], // 10 vs 10
    [['5', '4'], ['3', '7'], 'double'], // 9 vs 3
    [['5', '4'], ['2', '7'], 'hit'], // 9 vs 2
    [['A', '7'], ['3', '7'], 'double'], // soft 18 vs 3
    [['A', '7'], ['2', '7'], 'stand'], // soft 18 vs 2
    [['A', '7'], ['9', '7'], 'hit'], // soft 18 vs 9
    [['A', '8'], ['6', '7'], 'stand'], // soft 19 vs 6 (S17)
    [['A', '6'], ['2', '7'], 'hit'], // soft 17 vs 2
    [['A', '2'], ['5', '7'], 'double'], // soft 13 vs 5
    [['A', 'A'], ['10', '7'], 'split'],
    [['8', '8'], ['A', '7'], 'split'],
    [['9', '9'], ['7', '7'], 'stand'],
    [['9', '9'], ['8', '7'], 'split'],
    [['10', '10'], ['6', '7'], 'stand'],
    [['K', 'Q'], ['6', '7'], 'stand'],
    [['5', '5'], ['9', '7'], 'double'],
    [['4', '4'], ['5', '7'], 'split'], // DAS
    [['4', '4'], ['4', '7'], 'hit'],
    [['2', '2'], ['7', '7'], 'split'],
    [['6', '6'], ['7', '7'], 'hit'],
  ];

  it.each(cases)('player %j vs dealer %j -> %s', (player, dealer, expected) => {
    const state = deal(player, dealer, '2', '2', '2');
    expect(blackjackBasicStrategy(state)).toBe(expected);
    expect(blackjackBasicStrategy(blackjackPublicView(state))).toBe(expected);
  });

  it('falls back to allowed actions (double -> hit, double/stand -> stand)', () => {
    const threeCard11 = play(deal(['2', '4'], ['6', '7'], '5'), 'hit');
    expect(blackjackBasicStrategy(threeCard11)).toBe('hit');
    const threeCardSoft18 = play(deal(['A', '2'], ['4', '7'], '5'), 'hit');
    expect(handValue(threeCardSoft18.hands[0]!.cards)).toEqual({ total: 18, soft: true });
    expect(blackjackBasicStrategy(threeCardSoft18)).toBe('stand');
    // 8-8 on a split hand cannot be split again: hard 16 vs 10 -> hit.
    const split = blackjackApply(deal(['8', '8'], ['10', '7'], '8', '3'), 'split');
    expect(blackjackBasicStrategy(split)).toBe('hit');
  });

  it('returns null when the round is settled', () => {
    const settled = deal(['A', 'K'], ['9', '7']);
    expect(blackjackBasicStrategy(settled)).toBeNull();
    expect(blackjackBasicStrategy(blackjackPublicView(settled))).toBeNull();
  });
});

describe('blackjackReplay', () => {
  it('reproduces a played round from the seeds and the actions', () => {
    const seeds = { serverSeed: 'f'.repeat(64), clientSeed: 'verifica', nonce: 0 };
    for (let nonce = 0; nonce < 40; nonce++) {
      const rng = createRoundRng({ ...seeds, nonce });
      let state = blackjackDeal(500, rng);
      while (state.phase === 'player') {
        state = blackjackApply(state, blackjackBasicStrategy(state)!);
      }
      const replayed = blackjackReplay(500, createRoundRng({ ...seeds, nonce }), state.actions);
      expect(replayed).toEqual(state);
    }
  });

  it('throws on actions that were not legal', () => {
    const seeds = { serverSeed: 'e'.repeat(64), clientSeed: 'x', nonce: 3 };
    const extra: BlackjackAction[] = ['stand', 'stand', 'stand', 'stand'];
    expect(() => blackjackReplay(500, createRoundRng(seeds), extra)).toThrow(
      IllegalBlackjackActionError,
    );
  });
});

describe('properties with random shoes and random legal actions', () => {
  it('conserves cards, keeps stakes consistent and never mutates inputs', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 100 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        (seed, chipsBet, choices) => {
          const bet = chipsBet * 100;
          let state = blackjackDeal(bet, createSeededTestRng(seed));

          const counts = new Array<number>(52).fill(0);
          for (const code of state.shoe) counts[code]!++;
          expect(state.shoe).toHaveLength(52 * BLACKJACK_DECKS);
          expect(counts.every((n) => n === BLACKJACK_DECKS)).toBe(true);

          let stake = bet;
          let i = 0;
          while (state.phase === 'player') {
            const allowed = blackjackAllowedActions(state);
            expect(allowed.slice(0, 2)).toEqual(['hit', 'stand']);
            const suggestion = blackjackBasicStrategy(state);
            expect(allowed).toContain(suggestion);
            expect(blackjackBasicStrategy(blackjackPublicView(state))).toBe(suggestion);

            const view = blackjackPublicView(state);
            expect(view).not.toHaveProperty('shoe');
            expect(view.dealer.cards).toEqual([state.dealer[0], null]);
            expect(view.dealer.total).toBe(handValue([state.dealer[0]!]).total);
            expect(view.allowedActions).toEqual(allowed);

            const action = allowed[(choices[i++] ?? 1) % allowed.length]!;
            const snapshot = JSON.stringify(state);
            const cost = blackjackActionCost(state, action);
            const next = blackjackApply(state, action);
            expect(JSON.stringify(state)).toBe(snapshot);
            expect(next.step).toBe(state.step + 1);
            expect(next.actions).toEqual([...state.actions, action]);
            expect(blackjackTotalStake(next)).toBe(blackjackTotalStake(state) + cost);
            stake += cost;
            state = next;
          }

          // Cards on the table are exactly shoe[0..next).
          const onTable = [...state.hands.flatMap((h) => h.cards), ...state.dealer];
          const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
          expect(sortNum(onTable)).toEqual(sortNum(state.shoe.slice(0, state.next)));
          const seen = new Map<number, number>();
          for (const code of onTable) seen.set(code, (seen.get(code) ?? 0) + 1);
          expect([...seen.values()].every((n) => n <= BLACKJACK_DECKS)).toBe(true);

          const result = state.result!;
          expect(result.totalBet).toBe(stake);
          expect(result.totalBet).toBe(blackjackTotalStake(state));
          expect(result.totalBet).toBeLessThanOrEqual(4 * bet);
          expect(result.hands).toHaveLength(state.hands.length);
          result.hands.forEach((hr, idx) => {
            const handBet = state.hands[idx]!.bet;
            expect([0, handBet, 2 * handBet, (5 * handBet) / 2]).toContain(hr.payout);
          });
          expect(result.totalPayout).toBe(result.hands.reduce((s, h) => s + h.payout, 0));
          expect(result.totalPayout).toBeLessThanOrEqual(2.5 * result.totalBet);
          expect(state.step).toBe(state.actions.length);
          expect(JSON.parse(JSON.stringify(state))).toEqual(state);

          const replayed = blackjackReplay(bet, createSeededTestRng(seed), state.actions);
          expect(replayed).toEqual(state);
        },
      ),
      { numRuns: 400 },
    );
  });
});
