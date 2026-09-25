import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/fair/rng.ts';
import {
  SLOT_PAYTABLE,
  SLOT_STRIP,
  SLOT_STRIP_LENGTH,
  SLOT_SYMBOLS,
  evaluateSlot,
  settleSlot,
  slotExactStats,
  spinSlot,
  type SlotStops,
  type SlotSymbol,
} from '../src/games/slot/index.ts';

const index = (symbol: SlotSymbol, nth = 0): number => {
  const positions = SLOT_STRIP.flatMap((s, i) => (s === symbol ? [i] : []));
  return positions[nth]!;
};

describe('SLOT_STRIP', () => {
  it('has 20 positions with the documented symbol counts', () => {
    expect(SLOT_STRIP).toHaveLength(SLOT_STRIP_LENGTH);
    const counts = Object.fromEntries(SLOT_SYMBOLS.map((s) => [s, 0])) as Record<
      SlotSymbol,
      number
    >;
    for (const symbol of SLOT_STRIP) counts[symbol]++;
    expect(counts).toEqual({ SEVEN: 1, BAR: 2, BELL: 3, CHERRY: 4, LEMON: 5, ORANGE: 5 });
  });

  it('is spread out: no symbol sits next to itself (wrap-around included)', () => {
    for (let i = 0; i < SLOT_STRIP_LENGTH; i++) {
      expect(SLOT_STRIP[i]).not.toBe(SLOT_STRIP[(i + 1) % SLOT_STRIP_LENGTH]);
    }
  });
});

describe('slotExactStats', () => {
  it('RTP 7492/8000 and hit rate 1118/8000', () => {
    const stats = slotExactStats();
    expect(stats.combinations).toBe(8000);
    expect(stats.totalReturn).toBe(7492);
    expect(stats.rtp).toBe(7492 / 8000);
    expect(stats.hitRate).toBe(1118 / 8000);
  });

  it('agrees with an independent enumeration through evaluateSlot', () => {
    let total = 0;
    let hits = 0;
    const byKind: Record<string, number> = {};
    for (let a = 0; a < 20; a++) {
      for (let b = 0; b < 20; b++) {
        for (let c = 0; c < 20; c++) {
          const outcome = evaluateSlot([a, b, c]);
          total += outcome.multiplier;
          if (outcome.kind) {
            hits++;
            byKind[outcome.kind] = (byKind[outcome.kind] ?? 0) + 1;
          }
        }
      }
    }
    expect(total).toBe(7492);
    expect(hits).toBe(1118);
    expect(byKind).toEqual({
      THREE_SEVEN: 1,
      THREE_BAR: 8,
      THREE_BELL: 27,
      THREE_CHERRY: 64,
      THREE_LEMON: 125,
      THREE_ORANGE: 125,
      TWO_CHERRY: 768,
    });
  });
});

describe('evaluateSlot', () => {
  it('window rows are stop-1, stop, stop+1 with wrap-around at 0 and 19', () => {
    const outcome = evaluateSlot([0, 19, 10]);
    expect(outcome.stops).toEqual([0, 19, 10]);
    expect(outcome.window).toEqual([
      [SLOT_STRIP[19], SLOT_STRIP[18], SLOT_STRIP[9]],
      [SLOT_STRIP[0], SLOT_STRIP[19], SLOT_STRIP[10]],
      [SLOT_STRIP[1], SLOT_STRIP[0], SLOT_STRIP[11]],
    ]);
    expect(outcome.line).toEqual(outcome.window[1]);
  });

  it('three sevens pay 100', () => {
    const seven = index('SEVEN');
    const outcome = evaluateSlot([seven, seven, seven]);
    expect(outcome.line).toEqual(['SEVEN', 'SEVEN', 'SEVEN']);
    expect(outcome.kind).toBe('THREE_SEVEN');
    expect(outcome.multiplier).toBe(100);
  });

  it('three cherries pay 15, exactly two cherries pay 4 in any position', () => {
    const cherry = index('CHERRY', 0);
    const cherry2 = index('CHERRY', 3);
    const lemon = index('LEMON');
    expect(evaluateSlot([cherry, cherry2, cherry]).kind).toBe('THREE_CHERRY');
    expect(evaluateSlot([cherry, cherry2, cherry]).multiplier).toBe(SLOT_PAYTABLE.THREE_CHERRY);
    for (const stops of [
      [cherry, cherry2, lemon],
      [cherry, lemon, cherry2],
      [lemon, cherry, cherry2],
    ] as SlotStops[]) {
      const outcome = evaluateSlot(stops);
      expect(outcome.kind).toBe('TWO_CHERRY');
      expect(outcome.multiplier).toBe(4);
    }
    expect(evaluateSlot([cherry, lemon, lemon + 4]).kind).toBeNull();
  });

  it('mixed lines and one cherry pay nothing', () => {
    const outcome = evaluateSlot([index('BAR'), index('BAR', 1), index('BELL')]);
    expect(outcome.kind).toBeNull();
    expect(outcome.multiplier).toBe(0);
  });

  it('three of each symbol pays the paytable', () => {
    const kinds = {
      SEVEN: 'THREE_SEVEN',
      BAR: 'THREE_BAR',
      BELL: 'THREE_BELL',
      CHERRY: 'THREE_CHERRY',
      LEMON: 'THREE_LEMON',
      ORANGE: 'THREE_ORANGE',
    } as const;
    for (const symbol of SLOT_SYMBOLS) {
      const i = index(symbol);
      const outcome = evaluateSlot([i, i, i]);
      expect(outcome.kind).toBe(kinds[symbol]);
      expect(outcome.multiplier).toBe(SLOT_PAYTABLE[kinds[symbol]]);
    }
  });

  it('rejects invalid stops', () => {
    expect(() => evaluateSlot([20, 0, 0])).toThrow(RangeError);
    expect(() => evaluateSlot([-1, 0, 0])).toThrow(RangeError);
    expect(() => evaluateSlot([0, 0.5, 0])).toThrow(RangeError);
    expect(() => evaluateSlot([0, 0] as unknown as SlotStops)).toThrow(RangeError);
  });
});

describe('spinSlot / settleSlot', () => {
  it('draws exactly three rng.int(20), reel 0 first', () => {
    const calls: number[] = [];
    const values = [4, 11, 19];
    const rng: Rng = {
      nextUint32: () => {
        throw new Error('unexpected');
      },
      int: (n) => {
        calls.push(n);
        return values[calls.length - 1]!;
      },
    };
    expect(spinSlot(rng)).toEqual([4, 11, 19]);
    expect(calls).toEqual([20, 20, 20]);
  });

  it('win = bet * multiplier', () => {
    const seven = index('SEVEN');
    const settlement = settleSlot(300, [seven, seven, seven]);
    expect(settlement.bet).toBe(300);
    expect(settlement.win).toBe(30_000);
    const losing = settleSlot(300, [index('BAR'), index('BELL'), index('LEMON')]);
    expect(losing.win).toBe(0);
  });

  it('rejects invalid bets', () => {
    expect(() => settleSlot(0, [0, 0, 0])).toThrow(RangeError);
    expect(() => settleSlot(1.5, [0, 0, 0])).toThrow(RangeError);
  });
});
