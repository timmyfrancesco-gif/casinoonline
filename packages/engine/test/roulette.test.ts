import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createSeededTestRng, rngFromUint32Source, type Rng } from '../src/fair/rng.ts';
import {
  RED_NUMBERS,
  ROULETTE_BET_TYPES,
  ROULETTE_EVEN_TYPES,
  ROULETTE_INDEXED_TYPES,
  ROULETTE_INSIDE_TYPES,
  ROULETTE_PAYOUTS,
  WHEEL_ORDER,
  coveredNumbers,
  rouletteColor,
  settleRoulette,
  spinRoulette,
  validInsideCombinations,
  validateRouletteBet,
  type RouletteBet,
  type RouletteInsideType,
} from '../src/games/roulette/index.ts';

const AMOUNT = 700;

/** Every valid bet on the table (all inside combinations, dozens, columns, even-money). */
function allValidBets(amount: number): RouletteBet[] {
  const bets: RouletteBet[] = [];
  for (const type of ROULETTE_INSIDE_TYPES) {
    for (const numbers of validInsideCombinations(type)) bets.push({ type, numbers, amount });
  }
  for (const type of ROULETTE_INDEXED_TYPES) {
    for (const index of [1, 2, 3] as const) bets.push({ type, index, amount });
  }
  for (const type of ROULETTE_EVEN_TYPES) bets.push({ type, amount });
  return bets;
}

describe('rouletteColor', () => {
  it('matches the red table, zero is green, the rest black', () => {
    expect(rouletteColor(0)).toBe('green');
    let red = 0;
    let black = 0;
    for (let n = 1; n <= 36; n++) {
      const color = rouletteColor(n);
      expect(color).toBe(RED_NUMBERS.includes(n) ? 'red' : 'black');
      if (color === 'red') red++;
      else black++;
    }
    expect([red, black]).toEqual([18, 18]);
    expect(rouletteColor(1)).toBe('red');
    expect(rouletteColor(2)).toBe('black');
    expect(rouletteColor(10)).toBe('black');
    expect(rouletteColor(11)).toBe('black');
    expect(rouletteColor(19)).toBe('red');
    expect(rouletteColor(36)).toBe('red');
  });

  it('rejects numbers outside the wheel', () => {
    expect(() => rouletteColor(37)).toThrow(RangeError);
    expect(() => rouletteColor(-1)).toThrow(RangeError);
    expect(() => rouletteColor(1.5)).toThrow(RangeError);
  });

  it('the wheel order contains every pocket once', () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });
});

describe('validInsideCombinations', () => {
  const expected: Record<RouletteInsideType, number> = {
    straight: 37,
    split: 60,
    street: 12,
    trio: 2,
    corner: 22,
    basket: 1,
    sixline: 11,
  };

  it.each(ROULETTE_INSIDE_TYPES)('%s has the standard number of combinations', (type) => {
    const combos = validInsideCombinations(type);
    expect(combos).toHaveLength(expected[type]);
    const keys = new Set(combos.map((c) => c.join(',')));
    expect(keys.size).toBe(combos.length);
    for (const combo of combos) {
      expect(combo).toEqual([...combo].sort((a, b) => a - b));
      expect(validateRouletteBet({ type, numbers: combo, amount: AMOUNT })).toBeNull();
    }
  });

  it('splits: 57 among 1-36 plus the three zero splits', () => {
    const splits = validInsideCombinations('split');
    expect(splits.filter((c) => c[0] === 0)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(splits.filter((c) => c[0] !== 0)).toHaveLength(57);
    for (const [a, b] of splits.filter((c) => c[0] !== 0) as [number, number][]) {
      const horizontal = b === a + 1 && a % 3 !== 0;
      const vertical = b === a + 3;
      expect(horizontal || vertical).toBe(true);
    }
  });

  it('returns copies (mutating the result does not affect validation)', () => {
    const combos = validInsideCombinations('straight');
    combos[5]![0] = 99;
    expect(validInsideCombinations('straight')[5]).toEqual([5]);
  });
});

describe('expected return of every valid bet', () => {
  it('each bet returns exactly 36/37 of the stake over the 37 pockets', () => {
    const bets = allValidBets(AMOUNT);
    expect(bets).toHaveLength(37 + 60 + 12 + 2 + 22 + 1 + 11 + 3 + 3 + 6);
    for (const bet of bets) {
      expect(validateRouletteBet(bet)).toBeNull();
      let totalReturn = 0;
      for (let n = 0; n <= 36; n++) totalReturn += settleRoulette([bet], n).totalWin;
      // sum over outcomes = 36 * stake  =>  EV = 36/37 * stake, house edge 1/37
      expect(totalReturn).toBe(36 * AMOUNT);
      const covered = coveredNumbers(bet);
      expect(covered.length * (ROULETTE_PAYOUTS[bet.type] + 1)).toBe(36);
    }
  });

  it('zero loses every outside bet', () => {
    for (const bet of allValidBets(AMOUNT).filter((b) => !('numbers' in b))) {
      expect(settleRoulette([bet], 0).totalWin).toBe(0);
    }
  });
});

describe('coveredNumbers', () => {
  it('dozens, columns and even-money bets', () => {
    expect(coveredNumbers({ type: 'dozen', index: 1, amount: 1 })).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(coveredNumbers({ type: 'dozen', index: 3, amount: 1 })[0]).toBe(25);
    expect(coveredNumbers({ type: 'column', index: 1, amount: 1 })).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34,
    ]);
    expect(coveredNumbers({ type: 'column', index: 3, amount: 1 })).toEqual([
      3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36,
    ]);
    expect(coveredNumbers({ type: 'red', amount: 1 })).toEqual([...RED_NUMBERS]);
    expect(coveredNumbers({ type: 'black', amount: 1 })).toHaveLength(18);
    expect(coveredNumbers({ type: 'even', amount: 1 }).every((n) => n % 2 === 0 && n > 0)).toBe(
      true,
    );
    expect(coveredNumbers({ type: 'odd', amount: 1 })).toHaveLength(18);
    expect(coveredNumbers({ type: 'low', amount: 1 })).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    expect(coveredNumbers({ type: 'high', amount: 1 })).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 19),
    );
  });

  it('inside bets are sorted and not aliased', () => {
    const numbers = [5, 1, 4, 2];
    const covered = coveredNumbers({ type: 'corner', numbers, amount: 1 });
    expect(covered).toEqual([1, 2, 4, 5]);
    expect(numbers).toEqual([5, 1, 4, 2]);
  });
});

describe('validateRouletteBet', () => {
  const invalid: [string, unknown][] = [
    ['non-adjacent split', { type: 'split', numbers: [1, 5], amount: 100 }],
    ['split across rows', { type: 'split', numbers: [3, 4], amount: 100 }],
    ['zero split with 4', { type: 'split', numbers: [0, 4], amount: 100 }],
    ['bad corner', { type: 'corner', numbers: [3, 4, 6, 7], amount: 100 }],
    ['corner not a square', { type: 'corner', numbers: [1, 2, 3, 4], amount: 100 }],
    ['duplicate numbers', { type: 'split', numbers: [7, 7], amount: 100 }],
    ['duplicate numbers in corner', { type: 'corner', numbers: [1, 2, 4, 4], amount: 100 }],
    ['street not a row', { type: 'street', numbers: [2, 3, 4], amount: 100 }],
    ['bad trio', { type: 'trio', numbers: [0, 1, 3], amount: 100 }],
    ['bad basket', { type: 'basket', numbers: [0, 1, 2, 4], amount: 100 }],
    ['bad sixline', { type: 'sixline', numbers: [2, 3, 4, 5, 6, 7], amount: 100 }],
    ['straight on 37', { type: 'straight', numbers: [37], amount: 100 }],
    ['straight on -1', { type: 'straight', numbers: [-1], amount: 100 }],
    ['float number', { type: 'straight', numbers: [1.5], amount: 100 }],
    ['wrong count', { type: 'straight', numbers: [1, 2], amount: 100 }],
    ['missing numbers', { type: 'split', amount: 100 }],
    ['amount 0', { type: 'red', amount: 0 }],
    ['negative amount', { type: 'red', amount: -100 }],
    ['float amount', { type: 'red', amount: 1.5 }],
    ['unsafe amount', { type: 'red', amount: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN amount', { type: 'red', amount: Number.NaN }],
    ['string amount', { type: 'red', amount: '100' }],
    ['index 4', { type: 'dozen', index: 4, amount: 100 }],
    ['index 0', { type: 'column', index: 0, amount: 100 }],
    ['missing index', { type: 'column', amount: 100 }],
    ['unknown type', { type: 'voisins', amount: 100 }],
    ['null', null],
    ['array', []],
  ];

  it.each(invalid)('rejects %s with an Italian message', (_name, bet) => {
    const message = validateRouletteBet(bet as RouletteBet);
    expect(typeof message).toBe('string');
    expect(message!.length).toBeGreaterThan(5);
  });

  it('accepts numbers in any order', () => {
    expect(validateRouletteBet({ type: 'corner', numbers: [5, 1, 4, 2], amount: 100 })).toBeNull();
    expect(validateRouletteBet({ type: 'split', numbers: [3, 0], amount: 100 })).toBeNull();
    expect(validateRouletteBet({ type: 'trio', numbers: [3, 2, 0], amount: 100 })).toBeNull();
  });

  it('messages are in Italian', () => {
    expect(validateRouletteBet({ type: 'split', numbers: [1, 5], amount: 100 })).toMatch(
      /adiacenti/,
    );
    expect(validateRouletteBet({ type: 'red', amount: 0 })).toMatch(/importo/i);
  });

  it('random number sets are accepted exactly when they form a valid combination', () => {
    const validKeys = new Map<RouletteInsideType, Set<string>>(
      ROULETTE_INSIDE_TYPES.map((t) => [t, new Set(validInsideCombinations(t).map(String))]),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...ROULETTE_INSIDE_TYPES),
        fc.uniqueArray(fc.integer({ min: 0, max: 36 }), { minLength: 1, maxLength: 6 }),
        (type, numbers) => {
          const sorted = [...numbers].sort((a, b) => a - b);
          const valid = validKeys.get(type)!.has(String(sorted));
          expect(validateRouletteBet({ type, numbers, amount: 100 }) === null).toBe(valid);
        },
      ),
    );
  });
});

describe('spinRoulette', () => {
  it('uses exactly one rng.int(37) call', () => {
    const calls: number[] = [];
    const rng: Rng = {
      nextUint32: () => {
        throw new Error('unexpected');
      },
      int: (n) => {
        calls.push(n);
        return 17;
      },
    };
    expect(spinRoulette(rng)).toBe(17);
    expect(calls).toEqual([37]);
  });

  it('covers 0..36 with a real rng', () => {
    const rng = createSeededTestRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(spinRoulette(rng));
    expect(seen.size).toBe(37);
    expect(spinRoulette(rngFromUint32Source(() => 36))).toBe(36);
  });
});

describe('settleRoulette', () => {
  it('settles several bets at once', () => {
    const bets: RouletteBet[] = [
      { type: 'straight', numbers: [17], amount: 100 },
      { type: 'split', numbers: [17, 20], amount: 200 },
      { type: 'corner', numbers: [13, 14, 16, 17], amount: 100 },
      { type: 'red', amount: 500 },
      { type: 'black', amount: 500 },
      { type: 'dozen', index: 2, amount: 300 },
      { type: 'column', index: 1, amount: 300 },
      { type: 'odd', amount: 100 },
      { type: 'low', amount: 100 },
    ];
    const settlement = settleRoulette(bets, 17);
    expect(settlement.number).toBe(17);
    expect(settlement.color).toBe('black');
    expect(settlement.bets.map((b) => b.win)).toEqual([
      3600, // 35:1
      3600, // 17:1 on 200
      900, // 8:1
      0,
      1000,
      900, // 2:1
      0, // column 1 does not contain 17
      200,
      200,
    ]);
    expect(settlement.totalBet).toBe(2200);
    expect(settlement.totalWin).toBe(3600 + 3600 + 900 + 1000 + 900 + 200 + 200);
    expect(settlement.bets.map((b) => b.bet)).toEqual(bets);
  });

  it('zero pays only bets covering zero', () => {
    const settlement = settleRoulette(
      [
        { type: 'straight', numbers: [0], amount: 100 },
        { type: 'basket', numbers: [0, 1, 2, 3], amount: 100 },
        { type: 'even', amount: 100 },
      ],
      0,
    );
    expect(settlement.color).toBe('green');
    expect(settlement.totalWin).toBe(3600 + 900);
  });

  it('does not alias the input bets', () => {
    const bet: RouletteBet = { type: 'straight', numbers: [3], amount: 100 };
    const settlement = settleRoulette([bet], 3);
    (settlement.bets[0]!.bet as { numbers: number[] }).numbers.push(4);
    expect(bet.numbers).toEqual([3]);
  });

  it('rejects an impossible winning number', () => {
    expect(() => settleRoulette([], 37)).toThrow(RangeError);
  });

  it('empty bet list settles to zero', () => {
    expect(settleRoulette([], 5)).toMatchObject({ totalBet: 0, totalWin: 0, bets: [] });
  });

  it('every bet type is covered by the payout table', () => {
    for (const type of ROULETTE_BET_TYPES) expect(ROULETTE_PAYOUTS[type]).toBeGreaterThan(0);
  });
});
