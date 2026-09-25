import { describe, expect, it } from 'vitest';
import {
  ROULETTE_INSIDE_TYPES,
  coveredNumbers,
  validInsideCombinations,
  validateRouletteBet,
  type RouletteBet,
} from '@casino/engine';
import {
  aggregateBets,
  betKey,
  betLabel,
  insideCombinations,
  insideHotspots,
  numberAt,
  numberCell,
  numberRect,
  outsideSpots,
  pickNumber,
  placeChip,
  targetNumbers,
  toBet,
  toVerticalRect,
  totalStake,
  type BetTarget,
  type Placement,
  type TableRules,
} from './betBuilder.ts';

/** The engine may still be a stub while the app is developed in parallel. */
const engineReady = (() => {
  try {
    validateRouletteBet({ type: 'red', amount: 100 });
    return true;
  } catch {
    return false;
  }
})();

const RULES: TableRules = { maxPerBet: 10_000, maxPerRound: 50_000, maxBets: 40, balance: 100_000 };

describe('table geometry', () => {
  it('maps numbers to columns and rows of the standard layout', () => {
    expect(numberCell(1)).toEqual({ col: 1, row: 2 });
    expect(numberCell(3)).toEqual({ col: 1, row: 0 });
    expect(numberCell(35)).toEqual({ col: 12, row: 1 });
    for (let n = 1; n <= 36; n++) {
      const { col, row } = numberCell(n);
      expect(numberAt(col, row)).toBe(n);
    }
  });

  it('rotates the layout for narrow screens (1-2-3 on the first row, left to right)', () => {
    const v1 = toVerticalRect(numberRect(1));
    const v2 = toVerticalRect(numberRect(2));
    const v3 = toVerticalRect(numberRect(3));
    const v4 = toVerticalRect(numberRect(4));
    expect(v1.y).toBe(v2.y);
    expect(v2.y).toBe(v3.y);
    expect(v1.x).toBeLessThan(v2.x);
    expect(v2.x).toBeLessThan(v3.x);
    expect(v4.y).toBeGreaterThan(v1.y);
    expect(toVerticalRect(numberRect(0))).toMatchObject({ y: 0, w: 3 });
  });
});

describe('inside hotspots (cells, edges and corners)', () => {
  const spots = insideHotspots();
  const byType = (type: string) => spots.filter((s) => s.target.type === type);

  it('covers every inside combination of the European layout exactly once', () => {
    expect(byType('split')).toHaveLength(60);
    expect(byType('street')).toHaveLength(12);
    expect(byType('corner')).toHaveLength(22);
    expect(byType('sixline')).toHaveLength(11);
    expect(byType('trio')).toHaveLength(2);
    expect(byType('basket')).toHaveLength(1);
    expect(new Set(spots.map((s) => s.key)).size).toBe(spots.length);
  });

  it('maps edges between cells to the expected bets', () => {
    const find = (x: number, y: number) => spots.find((s) => s.at.x === x && s.at.y === y)?.target;
    // Vertical edge between 17 (col 6, row 1) and 20.
    expect(find(7, 1.5)).toEqual({ type: 'split', numbers: [17, 20] });
    // Horizontal edge between 17 (row 1) and 18 (row 0).
    expect(find(6.5, 1)).toEqual({ type: 'split', numbers: [17, 18] });
    // Corner at the intersection of 17, 18, 20, 21.
    expect(find(7, 1)).toEqual({ type: 'corner', numbers: [17, 18, 20, 21] });
    // Street on the outer edge of column 6 (16-17-18), six line between columns 6 and 7.
    expect(find(6.5, 3)).toEqual({ type: 'street', numbers: [16, 17, 18] });
    expect(find(7, 3)).toEqual({ type: 'sixline', numbers: [16, 17, 18, 19, 20, 21] });
    // Zero edge.
    expect(find(1, 0.5)).toEqual({ type: 'split', numbers: [0, 3] });
    expect(find(1, 2)).toEqual({ type: 'trio', numbers: [0, 1, 2] });
    expect(find(1, 1)).toEqual({ type: 'trio', numbers: [0, 2, 3] });
    expect(find(1, 3)).toEqual({ type: 'basket', numbers: [0, 1, 2, 3] });
  });

  it.skipIf(!engineReady)('produces bets that validateRouletteBet accepts', () => {
    for (const spot of spots) {
      const bet = toBet(spot.target, 100);
      expect(validateRouletteBet(bet), betKey(spot.target)).toBeNull();
    }
    for (let n = 0; n <= 36; n++) {
      expect(validateRouletteBet({ type: 'straight', numbers: [n], amount: 100 })).toBeNull();
    }
    for (const spot of outsideSpots()) {
      expect(validateRouletteBet(toBet(spot.target, 500))).toBeNull();
    }
  });

  it.skipIf(!engineReady)('matches the engine combinations and covered numbers', () => {
    for (const type of ROULETTE_INSIDE_TYPES) {
      const ours = insideCombinations(type)
        .map((c) => c.join('-'))
        .sort();
      const engine = validInsideCombinations(type)
        .map((c) => c.join('-'))
        .sort();
      expect(ours, type).toEqual(engine);
    }
    for (const spot of outsideSpots()) {
      const bet = toBet(spot.target, 100);
      expect(targetNumbers(spot.target), spot.key).toEqual(coveredNumbers(bet));
    }
  });
});

describe('outside spots', () => {
  it('has the 3 columns, 3 dozens and 6 even-money bets', () => {
    const spots = outsideSpots();
    expect(spots).toHaveLength(12);
    const column1 = spots.find((s) => s.key === 'column:1')!;
    // Column 1 (1, 4, ..., 34) sits on the bottom row next to 34.
    expect(column1.rect).toMatchObject({ x: 13, y: 2 });
    expect(targetNumbers(column1.target)).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
    expect(targetNumbers({ type: 'dozen', index: 2 })).toEqual(
      Array.from({ length: 12 }, (_, i) => 13 + i),
    );
  });
});

describe('pick mode', () => {
  it('completes a street with one click', () => {
    expect(pickNumber('street', [], 17)).toEqual({
      status: 'complete',
      target: { type: 'street', numbers: [16, 17, 18] },
    });
  });

  it('narrows splits and corners with a second click', () => {
    const first = pickNumber('split', [], 17);
    expect(first.status).toBe('partial');
    if (first.status !== 'partial') return;
    expect(first.candidates).toHaveLength(4);
    expect(pickNumber('split', first.selected, 18)).toEqual({
      status: 'complete',
      target: { type: 'split', numbers: [17, 18] },
    });
    expect(pickNumber('corner', [17], 21)).toEqual({
      status: 'complete',
      target: { type: 'corner', numbers: [17, 18, 20, 21] },
    });
  });

  it('builds six lines and trios', () => {
    expect(pickNumber('sixline', [17], 14)).toEqual({
      status: 'complete',
      target: { type: 'sixline', numbers: [13, 14, 15, 16, 17, 18] },
    });
    expect(pickNumber('trio', [], 1)).toEqual({
      status: 'complete',
      target: { type: 'trio', numbers: [0, 1, 2] },
    });
    expect(pickNumber('basket', [], 2)).toMatchObject({ status: 'complete' });
  });

  it('restarts from the new number when it does not fit the selection', () => {
    const r = pickNumber('split', [17], 30);
    expect(r).toMatchObject({ status: 'partial', selected: [30] });
    expect(pickNumber('trio', [], 20)).toEqual({ status: 'invalid' });
  });
});

describe('chip placement', () => {
  const red: BetTarget = { type: 'red' };
  const straight17: BetTarget = { type: 'straight', numbers: [17] };

  it('merges chips on the same bet and keeps the order', () => {
    let placements: Placement[] = [];
    for (const target of [straight17, red, straight17]) {
      const r = placeChip(placements, target, 500, RULES);
      expect(r.ok).toBe(true);
      if (r.ok) placements = r.placements;
    }
    const bets = aggregateBets(placements);
    expect(bets).toEqual<RouletteBet[]>([
      { type: 'straight', numbers: [17], amount: 1000 },
      { type: 'red', amount: 500 },
    ]);
    expect(totalStake(bets)).toBe(1500);
    // Undo = drop the last placement.
    expect(aggregateBets(placements.slice(0, -1))[0]).toMatchObject({ amount: 500 });
  });

  it('enforces max per bet, max per round, max bets and balance', () => {
    const one = placeChip([], red, 10_000, RULES);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(placeChip(one.placements, red, 100, RULES)).toMatchObject({ ok: false });

    const full: Placement[] = Array.from({ length: 5 }, (_, i) => ({
      target: { type: 'straight', numbers: [i] },
      amount: 10_000,
    }));
    const overRound = placeChip(full, { type: 'straight', numbers: [9] }, 100, RULES);
    expect(overRound).toMatchObject({ ok: false });
    if (!overRound.ok) expect(overRound.reason).toMatch(/500 fiches in totale/);

    const many: Placement[] = Array.from({ length: 40 }, (_, i) => ({
      target: { type: 'straight', numbers: [i % 37] },
      amount: 100,
    }));
    // 37 distinct keys only: add 3 distinct others to reach 40 bets.
    many.push(
      { target: red, amount: 100 },
      { target: { type: 'odd' }, amount: 100 },
      { target: { type: 'low' }, amount: 100 },
    );
    expect(aggregateBets(many)).toHaveLength(40);
    expect(placeChip(many, { type: 'high' }, 100, RULES)).toMatchObject({ ok: false });

    expect(placeChip([], red, 500, { ...RULES, balance: 400 })).toMatchObject({ ok: false });
  });

  it('labels bets in Italian', () => {
    expect(betLabel({ type: 'split', numbers: [18, 17] })).toBe('Cavallo 17-18');
    expect(betLabel({ type: 'sixline', numbers: [16, 17, 18, 19, 20, 21] })).toBe('Sestina 16-21');
    expect(betLabel({ type: 'dozen', index: 2 })).toBe('2ª dozzina (13-24)');
    expect(betLabel({ type: 'black' })).toBe('Nero');
    expect(betKey({ type: 'corner', numbers: [21, 17, 20, 18] })).toBe('corner:17-18-20-21');
  });
});
