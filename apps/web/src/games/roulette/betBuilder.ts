/**
 * Roulette table model: geometry of the European layout, mapping of cells/edges to
 * bets, chip placement with table limits, and a "pick" mode that builds inside bets
 * from number clicks (keyboard-friendly alternative to the small edge hotspots).
 *
 * Geometry uses abstract units of the horizontal layout (14 x 5):
 *   x 0..1  zero (rows 0..3)      x 1..13 numbers, column c (1..12) at x = c
 *   x 13..14 column bets "2:1"    y 0..3 number rows (row 0 = 3,6,..,36; row 2 = 1,4,..,34)
 *   y 3..4  dozens                y 4..5 even-money bets
 * The vertical (mobile) layout is the same table rotated: (x, y) -> (5 - y, x).
 */
import {
  RED_NUMBERS,
  type Amount,
  type RouletteBet,
  type RouletteEvenType,
  type RouletteIndexedType,
  type RouletteInsideType,
} from '@casino/engine';

export const TABLE_W = 14;
export const TABLE_H = 5;
export const VERTICAL_W = TABLE_H;
export const VERTICAL_H = TABLE_W;

export type NumberColor = 'green' | 'red' | 'black';

export function numberColor(n: number): NumberColor {
  if (n === 0) return 'green';
  return RED_NUMBERS.includes(n) ? 'red' : 'black';
}

export const COLOR_NAMES_IT: Record<NumberColor, string> = {
  green: 'verde',
  red: 'rosso',
  black: 'nero',
};

// ---------------------------------------------------------------------------
// Bet targets (a bet without its amount)
// ---------------------------------------------------------------------------

export type BetTarget =
  | { type: RouletteInsideType; numbers: number[] }
  | { type: RouletteIndexedType; index: 1 | 2 | 3 }
  | { type: RouletteEvenType };

export function isInsideTarget(
  target: BetTarget,
): target is { type: RouletteInsideType; numbers: number[] } {
  return 'numbers' in target;
}

/** Canonical key: equal bets share a key (numbers sorted). */
export function betKey(target: BetTarget): string {
  if ('numbers' in target) {
    return `${target.type}:${[...target.numbers].sort((a, b) => a - b).join('-')}`;
  }
  if ('index' in target) return `${target.type}:${target.index}`;
  return target.type;
}

export function toBet(target: BetTarget, amount: Amount): RouletteBet {
  if ('numbers' in target) {
    return {
      type: target.type,
      numbers: [...target.numbers].sort((a, b) => a - b),
      amount,
    };
  }
  if ('index' in target) return { type: target.type, index: target.index, amount };
  return { type: target.type, amount };
}

export function targetOf(bet: RouletteBet): BetTarget {
  if ('numbers' in bet) return { type: bet.type, numbers: bet.numbers };
  if ('index' in bet) return { type: bet.type, index: bet.index };
  return { type: bet.type };
}

export const INSIDE_TYPE_NAMES_IT: Record<RouletteInsideType, string> = {
  straight: 'Pieno',
  split: 'Cavallo',
  street: 'Terzina',
  trio: 'Tris con lo zero',
  corner: 'Carré',
  basket: 'Prima quattro',
  sixline: 'Sestina',
};

const EVEN_NAMES_IT: Record<RouletteEvenType, string> = {
  red: 'Rosso',
  black: 'Nero',
  even: 'Pari',
  odd: 'Dispari',
  low: 'Manque (1-18)',
  high: 'Passe (19-36)',
};

const ORDINALS = ['', '1ª', '2ª', '3ª'] as const;

/** Italian description, e.g. "Cavallo 17-18", "2ª dozzina (13-24)", "Rosso". */
export function betLabel(target: BetTarget): string {
  if ('numbers' in target) {
    const nums = [...target.numbers].sort((a, b) => a - b);
    const name = INSIDE_TYPE_NAMES_IT[target.type];
    if (target.type === 'sixline') return `${name} ${nums[0]}-${nums[nums.length - 1]}`;
    return `${name} ${nums.join('-')}`;
  }
  if ('index' in target) {
    if (target.type === 'dozen') {
      const lo = (target.index - 1) * 12 + 1;
      return `${ORDINALS[target.index]} dozzina (${lo}-${lo + 11})`;
    }
    return `${ORDINALS[target.index]} colonna (${target.index}, ${target.index + 3} … ${target.index + 33})`;
  }
  return EVEN_NAMES_IT[target.type];
}

/** Numbers covered by a target (sorted). */
export function targetNumbers(target: BetTarget): number[] {
  if ('numbers' in target) return [...target.numbers].sort((a, b) => a - b);
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  if ('index' in target) {
    if (target.type === 'dozen') return all.filter((n) => Math.ceil(n / 12) === target.index);
    return all.filter((n) => ((n - 1) % 3) + 1 === target.index);
  }
  switch (target.type) {
    case 'red':
      return all.filter((n) => RED_NUMBERS.includes(n));
    case 'black':
      return all.filter((n) => !RED_NUMBERS.includes(n));
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'low':
      return all.filter((n) => n <= 18);
    case 'high':
      return all.filter((n) => n >= 19);
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

/** Column 1..12 and row 0..2 (0 = top row 3,6,..,36) of a number 1..36. */
export function numberCell(n: number): { col: number; row: number } {
  return { col: Math.ceil(n / 3), row: 2 - ((n - 1) % 3) };
}

export function numberAt(col: number, row: number): number {
  return (col - 1) * 3 + (3 - row);
}

export function numberRect(n: number): Rect {
  if (n === 0) return { x: 0, y: 0, w: 1, h: 3 };
  const { col, row } = numberCell(n);
  return { x: col, y: row, w: 1, h: 1 };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Vertical layout: the horizontal table rotated so that 1-2-3 reads left to right on top. */
export function toVerticalRect(r: Rect): Rect {
  return { x: VERTICAL_W - r.y - r.h, y: r.x, w: r.h, h: r.w };
}

export function toVerticalPoint(p: Point): Point {
  return { x: VERTICAL_W - p.y, y: p.x };
}

export interface OutsideSpot {
  key: string;
  target: BetTarget;
  rect: Rect;
  /** Short visible text. */
  text: string;
}

export function outsideSpots(): OutsideSpot[] {
  const spots: OutsideSpot[] = [];
  for (const index of [1, 2, 3] as const) {
    const target: BetTarget = { type: 'column', index };
    // Column 1 (1,4,..,34) is the bottom row (row 2).
    spots.push({
      key: betKey(target),
      target,
      rect: { x: 13, y: 3 - index, w: 1, h: 1 },
      text: '2:1',
    });
  }
  for (const index of [1, 2, 3] as const) {
    const target: BetTarget = { type: 'dozen', index };
    const lo = (index - 1) * 12 + 1;
    spots.push({
      key: betKey(target),
      target,
      rect: { x: 1 + (index - 1) * 4, y: 3, w: 4, h: 1 },
      text: `${lo}-${lo + 11}`,
    });
  }
  const evens: [RouletteEvenType, string][] = [
    ['low', '1-18'],
    ['even', 'Pari'],
    ['red', 'Rosso'],
    ['black', 'Nero'],
    ['odd', 'Dispari'],
    ['high', '19-36'],
  ];
  evens.forEach(([type, text], i) => {
    const target: BetTarget = { type };
    spots.push({ key: betKey(target), target, rect: { x: 1 + i * 2, y: 4, w: 2, h: 1 }, text });
  });
  return spots;
}

export interface InsideSpot {
  key: string;
  target: { type: RouletteInsideType; numbers: number[] };
  /** Hotspot centre (horizontal units). */
  at: Point;
}

function inside(type: RouletteInsideType, numbers: number[], at: Point): InsideSpot {
  const target = { type, numbers: [...numbers].sort((a, b) => a - b) };
  return { key: betKey(target), target, at };
}

/**
 * Edge and corner hotspots: every split, street, corner, six line, trio and basket of the
 * layout. Straight bets are the number cells themselves.
 */
export function insideHotspots(): InsideSpot[] {
  const spots: InsideSpot[] = [];
  for (let col = 1; col <= 12; col++) {
    for (let row = 0; row <= 2; row++) {
      const n = numberAt(col, row);
      // Split with the number to the right (n + 3), on the shared vertical edge.
      if (col < 12) spots.push(inside('split', [n, n + 3], { x: col + 1, y: row + 0.5 }));
      // Split with the number above (n + 1), on the shared horizontal edge.
      if (row > 0) {
        spots.push(inside('split', [n, n + 1], { x: col + 0.5, y: row }));
        // Corner n, n+1, n+3, n+4 at the intersection.
        if (col < 12)
          spots.push(inside('corner', [n, n + 1, n + 3, n + 4], { x: col + 1, y: row }));
      }
    }
    const first = numberAt(col, 2);
    // Street on the outer (bottom) edge of the column; six line between two columns.
    spots.push(inside('street', [first, first + 1, first + 2], { x: col + 0.5, y: 3 }));
    if (col < 12) {
      spots.push(
        inside('sixline', [first, first + 1, first + 2, first + 3, first + 4, first + 5], {
          x: col + 1,
          y: 3,
        }),
      );
    }
  }
  // Zero combinations along the zero's edge.
  spots.push(inside('split', [0, 1], { x: 1, y: 2.5 }));
  spots.push(inside('split', [0, 2], { x: 1, y: 1.5 }));
  spots.push(inside('split', [0, 3], { x: 1, y: 0.5 }));
  spots.push(inside('trio', [0, 1, 2], { x: 1, y: 2 }));
  spots.push(inside('trio', [0, 2, 3], { x: 1, y: 1 }));
  spots.push(inside('basket', [0, 1, 2, 3], { x: 1, y: 3 }));
  return spots;
}

let combosCache: Map<RouletteInsideType, number[][]> | null = null;

/** Every valid combination for an inside bet type (sorted arrays). */
export function insideCombinations(type: RouletteInsideType): number[][] {
  if (!combosCache) {
    combosCache = new Map();
    combosCache.set(
      'straight',
      Array.from({ length: 37 }, (_, n) => [n]),
    );
    for (const spot of insideHotspots()) {
      const list = combosCache.get(spot.target.type) ?? [];
      list.push(spot.target.numbers);
      combosCache.set(spot.target.type, list);
    }
  }
  return combosCache.get(type) ?? [];
}

// ---------------------------------------------------------------------------
// Pick mode: build an inside bet by clicking numbers
// ---------------------------------------------------------------------------

export type PickResult =
  | { status: 'complete'; target: { type: RouletteInsideType; numbers: number[] } }
  | { status: 'partial'; selected: number[]; candidates: number[][] }
  | { status: 'invalid' };

function candidatesFor(type: RouletteInsideType, selected: number[]): number[][] {
  return insideCombinations(type).filter((combo) => selected.every((n) => combo.includes(n)));
}

/**
 * Adds a clicked number to the selection. When exactly one combination of `type`
 * contains every selected number the bet is complete. Clicking a number that fits no
 * candidate restarts the selection from that number.
 */
export function pickNumber(type: RouletteInsideType, selected: number[], n: number): PickResult {
  const withN = selected.includes(n) ? selected : [...selected, n];
  let candidates = candidatesFor(type, withN);
  let chosen = withN;
  if (candidates.length === 0) {
    chosen = [n];
    candidates = candidatesFor(type, chosen);
  }
  if (candidates.length === 0) return { status: 'invalid' };
  if (candidates.length === 1) {
    return { status: 'complete', target: { type, numbers: candidates[0]! } };
  }
  return { status: 'partial', selected: chosen, candidates };
}

/** Short Italian instructions for pick mode. */
export const PICK_HINTS: Record<RouletteInsideType, string> = {
  straight: 'Tocca un numero per puntarlo pieno.',
  split: 'Tocca due numeri vicini (anche lo 0 con 1, 2 o 3).',
  street: 'Tocca un numero qualsiasi della riga di tre numeri.',
  trio: 'Tocca 1 (per 0-1-2) oppure 3 (per 0-2-3).',
  corner: 'Tocca due numeri in diagonale del quadrato di quattro.',
  basket: 'Tocca 0, 1, 2 o 3.',
  sixline: 'Tocca un numero, poi un numero della riga vicina.',
};

// ---------------------------------------------------------------------------
// Chip placement with table limits
// ---------------------------------------------------------------------------

export interface Placement {
  target: BetTarget;
  amount: Amount;
}

export interface TableRules {
  maxPerBet: Amount;
  maxPerRound: Amount;
  maxBets: number;
  /** Current balance (null = unknown, not checked). */
  balance: Amount | null;
}

/** Aggregates chip placements into bets (order of first placement). */
export function aggregateBets(placements: readonly Placement[]): RouletteBet[] {
  const map = new Map<string, { target: BetTarget; amount: Amount }>();
  for (const p of placements) {
    const key = betKey(p.target);
    const existing = map.get(key);
    if (existing) existing.amount += p.amount;
    else map.set(key, { target: p.target, amount: p.amount });
  }
  return Array.from(map.values(), (b) => toBet(b.target, b.amount));
}

export function totalStake(bets: readonly { amount: Amount }[]): Amount {
  return bets.reduce((sum, b) => sum + b.amount, 0);
}

export type PlaceResult = { ok: true; placements: Placement[] } | { ok: false; reason: string };

function chips(units: Amount): string {
  return (units / 100).toLocaleString('it-IT');
}

/** Adds one chip on a target, enforcing table limits and balance. */
export function placeChip(
  placements: readonly Placement[],
  target: BetTarget,
  amount: Amount,
  rules: TableRules,
): PlaceResult {
  const bets = aggregateBets(placements);
  const key = betKey(target);
  const existing = bets.find((b) => betKey(targetOf(b)) === key);
  const total = totalStake(bets);
  if (!existing && bets.length >= rules.maxBets) {
    return { ok: false, reason: `Puoi fare al massimo ${rules.maxBets} puntate diverse per giro.` };
  }
  if ((existing?.amount ?? 0) + amount > rules.maxPerBet) {
    return {
      ok: false,
      reason: `Massimo ${chips(rules.maxPerBet)} fiches su una singola puntata (${betLabel(target)}).`,
    };
  }
  if (total + amount > rules.maxPerRound) {
    return { ok: false, reason: `Massimo ${chips(rules.maxPerRound)} fiches in totale per giro.` };
  }
  if (rules.balance !== null && total + amount > rules.balance) {
    return { ok: false, reason: 'Saldo insufficiente per aggiungere questa fiche.' };
  }
  return { ok: true, placements: [...placements, { target, amount }] };
}

/** Total returned by a bet if `winning` comes out (stake included), 0 if lost. */
export function betReturn(bet: RouletteBet, winning: number, payoutRatio: number): Amount {
  return targetNumbers(targetOf(bet)).includes(winning) ? bet.amount * (payoutRatio + 1) : 0;
}
