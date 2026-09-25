import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { orderedShoe, type CardCode } from '../src/cards.ts';
import { createRoundRng, createSeededTestRng, shuffleInPlace } from '../src/fair/rng.ts';
import {
  IllegalVideoPokerActionError,
  POKER_HAND_RANKS,
  VIDEO_POKER_PAYTABLE,
  evaluatePokerHand,
  videoPokerDeal,
  videoPokerDealFromDeck,
  videoPokerDraw,
  videoPokerHoldAnalysis,
  videoPokerPublicView,
  videoPokerReplay,
  type PokerHandRank,
} from '../src/games/videopoker/index.ts';

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
  T: 9,
  J: 10,
  Q: 11,
  K: 12,
};
const SUIT_INDEX: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };

/** Parses "As Kh Td 2c 9s" into card codes. */
function hand(text: string): CardCode[] {
  return text.split(' ').map((token) => {
    const rank = RANK_INDEX[token.slice(0, -1)];
    const suit = SUIT_INDEX[token.slice(-1)];
    if (rank === undefined || suit === undefined) throw new Error(`bad card ${token}`);
    return rank + 13 * suit;
  });
}

/** Deck whose first cards are `first`, followed by the remaining cards in order. */
function deckStartingWith(first: CardCode[]): CardCode[] {
  const rest = orderedShoe(1).filter((c) => !first.includes(c));
  return [...first, ...rest];
}

describe('evaluatePokerHand', () => {
  it('counts every one of the 2,598,960 five-card hands exactly', () => {
    const counts = Object.fromEntries(POKER_HAND_RANKS.map((r) => [r, 0])) as Record<
      PokerHandRank,
      number
    >;
    const cards = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++) {
      cards[0] = a;
      for (let b = a + 1; b < 52; b++) {
        cards[1] = b;
        for (let c = b + 1; c < 52; c++) {
          cards[2] = c;
          for (let d = c + 1; d < 52; d++) {
            cards[3] = d;
            for (let e = d + 1; e < 52; e++) {
              cards[4] = e;
              counts[evaluatePokerHand(cards)]++;
            }
          }
        }
      }
    }
    const expected = {
      ROYAL_FLUSH: 4,
      STRAIGHT_FLUSH: 36,
      FOUR_OF_A_KIND: 624,
      FULL_HOUSE: 3744,
      FLUSH: 5108,
      STRAIGHT: 10200,
      THREE_OF_A_KIND: 54912,
      TWO_PAIR: 123552,
      JACKS_OR_BETTER: 337920,
    };
    const paying = Object.values(expected).reduce((s, n) => s + n, 0);
    expect(counts).toEqual({ ...expected, NOTHING: 2_598_960 - paying });
  }, 20_000);

  it.each([
    ['As Ks Qs Js Ts', 'ROYAL_FLUSH'],
    ['Th Jh Qh Kh Ah', 'ROYAL_FLUSH'],
    ['9s Ks Qs Js Ts', 'STRAIGHT_FLUSH'],
    ['As 2s 3s 4s 5s', 'STRAIGHT_FLUSH'],
    ['7d 7h 7s 7c 2d', 'FOUR_OF_A_KIND'],
    ['7d 7h 7s 2c 2d', 'FULL_HOUSE'],
    ['2h 9h Jh Kh 4h', 'FLUSH'],
    ['As 2d 3s 4h 5c', 'STRAIGHT'],
    ['Ts Jd Qs Kh Ac', 'STRAIGHT'],
    ['6s 7d 8s 9h Tc', 'STRAIGHT'],
    ['Qs Kd As 2h 3c', 'NOTHING'],
    ['Js Jd 7s 7h 7c', 'FULL_HOUSE'],
    ['9s 9d 9h Kh 2c', 'THREE_OF_A_KIND'],
    ['9s 9d 4h 4c 2c', 'TWO_PAIR'],
    ['2s 2d 3h 3c Ac', 'TWO_PAIR'],
    ['Js Jd 4h 5c 2c', 'JACKS_OR_BETTER'],
    ['As Ad 4h 5c 2c', 'JACKS_OR_BETTER'],
    ['Ks Kd 4h 5c 2c', 'JACKS_OR_BETTER'],
    ['Ts Td 4h 5c 2c', 'NOTHING'],
    ['2s 5d 9h Jc Kc', 'NOTHING'],
  ] as [string, PokerHandRank][])('%s is %s', (text, rank) => {
    expect(evaluatePokerHand(hand(text))).toBe(rank);
  });

  it('does not depend on the order of the cards', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 5, maxLength: 5 }),
        (cards) => {
          const rank = evaluatePokerHand(cards);
          expect(evaluatePokerHand([...cards].reverse())).toBe(rank);
          expect(evaluatePokerHand([cards[2]!, cards[0]!, cards[4]!, cards[1]!, cards[3]!])).toBe(
            rank,
          );
        },
      ),
    );
  });

  it('rejects anything but 5 distinct cards', () => {
    expect(() => evaluatePokerHand([1, 2, 3, 4])).toThrow(RangeError);
    expect(() => evaluatePokerHand([1, 2, 3, 4, 4])).toThrow(RangeError);
    expect(() => evaluatePokerHand([1, 2, 3, 4, 52])).toThrow(RangeError);
    expect(() => evaluatePokerHand([1, 2, 3, 4, 5, 6])).toThrow(RangeError);
    expect(() => evaluatePokerHand([30, 40, 50, 51, 30])).toThrow(RangeError);
  });
});

describe('deal and draw', () => {
  it('deals deck[0..4] from a shuffled 52-card deck', () => {
    const state = videoPokerDeal(300, createSeededTestRng(1));
    expect([...state.deck].sort((a, b) => a - b)).toEqual(orderedShoe(1));
    expect(state.hand).toEqual(state.deck.slice(0, 5));
    expect(state).toMatchObject({ bet: 300, held: null, phase: 'hold', step: 0, result: null });
  });

  it('uses the documented shuffle', () => {
    const seeds = { serverSeed: '1'.repeat(64), clientSeed: 'vp', nonce: 9 };
    const deck = shuffleInPlace(createRoundRng(seeds), orderedShoe(1));
    expect(videoPokerDeal(100, createRoundRng(seeds)).deck).toEqual(deck);
  });

  it('replaces non-held positions left to right with deck[5], deck[6], ...', () => {
    const deck = deckStartingWith(hand('As Kd 7c 2h 9s Ad 3c 4c 8d'));
    const state = videoPokerDealFromDeck(200, deck);
    const settled = videoPokerDraw(state, [true, false, false, true, false]);
    expect(settled.hand).toEqual([deck[0], deck[5], deck[6], deck[3], deck[7]]);
    expect(settled.phase).toBe('settled');
    expect(settled.step).toBe(1);
    expect(settled.held).toEqual([true, false, false, true, false]);
    expect(settled.result).toEqual({ rank: 'JACKS_OR_BETTER', multiplier: 1, payout: 200 });
  });

  it('holding everything keeps the hand; paytable multiples apply', () => {
    const deck = deckStartingWith(hand('7d 7h 7s 2c 2d'));
    const settled = videoPokerDraw(videoPokerDealFromDeck(500, deck), Array(5).fill(true));
    expect(settled.hand).toEqual(deck.slice(0, 5));
    expect(settled.result).toEqual({ rank: 'FULL_HOUSE', multiplier: 9, payout: 4500 });
  });

  it('discarding everything draws deck[5..9]', () => {
    const deck = deckStartingWith(hand('2s 5d 9h Jc Kc As Ks Qs Js Ts'));
    const settled = videoPokerDraw(videoPokerDealFromDeck(100, deck), Array(5).fill(false));
    expect(settled.hand).toEqual(deck.slice(5, 10));
    expect(settled.result).toEqual({
      rank: 'ROYAL_FLUSH',
      multiplier: VIDEO_POKER_PAYTABLE.ROYAL_FLUSH,
      payout: 80_000,
    });
  });

  it('drawing twice is illegal', () => {
    const state = videoPokerDeal(100, createSeededTestRng(2));
    const settled = videoPokerDraw(state, [false, false, false, false, false]);
    expect(() => videoPokerDraw(settled, [true, true, true, true, true])).toThrow(
      IllegalVideoPokerActionError,
    );
  });

  it('rejects malformed hold masks', () => {
    const state = videoPokerDeal(100, createSeededTestRng(3));
    expect(() => videoPokerDraw(state, [true, true])).toThrow(IllegalVideoPokerActionError);
    expect(() => videoPokerDraw(state, [1, 0, 1, 0, 1] as unknown as boolean[])).toThrow(
      IllegalVideoPokerActionError,
    );
  });

  it('is pure: the input state is not mutated', () => {
    const state = videoPokerDeal(100, createSeededTestRng(4));
    const snapshot = structuredClone(state);
    const held = [true, false, true, false, false];
    videoPokerDraw(Object.freeze(state), held);
    expect(state).toEqual(snapshot);
    expect(held).toEqual([true, false, true, false, false]);
  });

  it('rejects bad bets and decks', () => {
    expect(() => videoPokerDealFromDeck(0, orderedShoe(1))).toThrow(RangeError);
    expect(() => videoPokerDealFromDeck(100, orderedShoe(1).slice(1))).toThrow(RangeError);
    const dup = orderedShoe(1);
    dup[51] = 0;
    expect(() => videoPokerDealFromDeck(100, dup)).toThrow(RangeError);
  });

  it('state survives a JSON round trip', () => {
    const state = videoPokerDraw(videoPokerDeal(100, createSeededTestRng(5)), [
      true,
      true,
      false,
      false,
      true,
    ]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('videoPokerPublicView', () => {
  it('never exposes the deck', () => {
    const deck = deckStartingWith(hand('Js Jd 4h 5c 2c'));
    const state = videoPokerDealFromDeck(100, deck);
    const view = videoPokerPublicView(state);
    expect(view).not.toHaveProperty('deck');
    expect(Object.keys(view).sort()).toEqual(
      ['bet', 'currentRank', 'dealt', 'hand', 'held', 'phase', 'result', 'step'].sort(),
    );
    expect(view).toEqual({
      bet: 100,
      phase: 'hold',
      step: 0,
      hand: deck.slice(0, 5),
      dealt: deck.slice(0, 5),
      held: null,
      currentRank: 'JACKS_OR_BETTER',
      result: null,
    });
  });

  it('after the draw shows the final hand and the original deal', () => {
    const deck = deckStartingWith(hand('Js Jd 4h 5c 2c Jh 4d 9c'));
    const settled = videoPokerDraw(videoPokerDealFromDeck(100, deck), [
      true,
      true,
      false,
      false,
      true,
    ]);
    const view = videoPokerPublicView(settled);
    expect(view.dealt).toEqual(deck.slice(0, 5));
    expect(view.hand).toEqual(settled.hand);
    expect(view.currentRank).toBe('THREE_OF_A_KIND');
    expect(view.result).toEqual({ rank: 'THREE_OF_A_KIND', multiplier: 3, payout: 300 });
    expect(view).not.toHaveProperty('deck');
  });
});

describe('videoPokerReplay', () => {
  it('reproduces deal + draw from the seeds', () => {
    const seeds = { serverSeed: 'c'.repeat(64), clientSeed: 'poker', nonce: 12 };
    const held = [false, true, true, false, true];
    const direct = videoPokerDraw(videoPokerDeal(700, createRoundRng(seeds)), held);
    expect(videoPokerReplay(700, createRoundRng(seeds), held)).toEqual(direct);
  });
});

describe('videoPokerHoldAnalysis', () => {
  const maskKey = (held: boolean[]) => held.map((h) => (h ? '1' : '0')).join('');

  function bruteForceEv(cards: CardCode[], held: boolean[]): number {
    const rest = orderedShoe(1).filter((c) => !cards.includes(c));
    const kept = cards.filter((_, i) => held[i]);
    const need = 5 - kept.length;
    let total = 0;
    let count = 0;
    const pick = (start: number, chosen: CardCode[]): void => {
      if (chosen.length === need) {
        total += VIDEO_POKER_PAYTABLE[evaluatePokerHand([...kept, ...chosen])];
        count++;
        return;
      }
      for (let i = start; i < rest.length; i++) pick(i + 1, [...chosen, rest[i]!]);
    };
    pick(0, []);
    return total / count;
  }

  it('a dealt royal flush: holding all five is best with EV 800', () => {
    const start = performance.now();
    const result = videoPokerHoldAnalysis(hand('As Ts Js Qs Ks'));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result).toHaveLength(32);
    expect(new Set(result.map((r) => maskKey(r.held))).size).toBe(32);
    expect(result[0]).toEqual({ held: [true, true, true, true, true], ev: 800 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.ev).toBeGreaterThanOrEqual(result[i]!.ev);
    }
  });

  it('a pat full house: holding all five is best with EV 9', () => {
    const result = videoPokerHoldAnalysis(hand('Kd Kh Ks 5s 5h'));
    expect(result[0]).toEqual({ held: [true, true, true, true, true], ev: 9 });
    expect(result[1]!.ev).toBeLessThan(9);
  });

  it('four to a royal: EV 872/47', () => {
    const result = videoPokerHoldAnalysis(hand('As Ks Qs Js 2h'));
    expect(result[0]!.held).toEqual([true, true, true, true, false]);
    expect(result[0]!.ev).toBeCloseTo(872 / 47, 12);
  });

  it('matches a brute-force enumeration for masks drawing up to three cards', () => {
    const cards = hand('Jh Td 9c 4s 4h');
    const result = videoPokerHoldAnalysis(cards);
    const byMask = new Map(result.map((r) => [maskKey(r.held), r.ev]));
    for (let mask = 0; mask < 32; mask++) {
      const held = [0, 1, 2, 3, 4].map((i) => (mask & (1 << i)) !== 0);
      if (held.filter(Boolean).length < 2) continue;
      expect(byMask.get(maskKey(held))).toBeCloseTo(bruteForceEv(cards, held), 12);
    }
  });

  it('every analysis runs well under 2 s', () => {
    const rng = createSeededTestRng(99);
    for (let i = 0; i < 3; i++) {
      const cards = shuffleInPlace(rng, orderedShoe(1)).slice(0, 5);
      const start = performance.now();
      const result = videoPokerHoldAnalysis(cards);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(result).toHaveLength(32);
      expect(result[0]!.ev).toBeGreaterThan(0);
    }
  });

  it('rejects invalid hands', () => {
    expect(() => videoPokerHoldAnalysis([1, 2, 3])).toThrow(RangeError);
    expect(() => videoPokerHoldAnalysis([1, 1, 2, 3, 4])).toThrow(RangeError);
  });
});
