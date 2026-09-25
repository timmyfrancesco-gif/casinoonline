/**
 * European roulette (single zero, 37 pockets 0..36). CONTRACT FILE: the exported
 * names, types and semantics below are relied upon by the server and the web app.
 *
 * Rules
 * - Inside bets (the `numbers` field lists the covered numbers, any order):
 *     straight 1 number 35:1 | split 2 adjacent numbers 17:1 | street 3 numbers of a row 11:1
 *     trio {0,1,2} or {0,2,3} 11:1 | corner 4 numbers in a square 8:1
 *     basket {0,1,2,3} ("first four") 8:1 | sixline 2 adjacent rows (6 numbers) 5:1
 *   Adjacency follows the standard layout: rows are {1,2,3}, {4,5,6}, ... {34,35,36};
 *   n and n+1 are adjacent only when in the same row; n and n+3 are adjacent.
 *   Zero splits: {0,1}, {0,2}, {0,3} are valid splits.
 * - Outside bets: dozen (index 1: 1-12, 2: 13-24, 3: 25-36) 2:1,
 *   column (index 1: 1,4,..,34; 2: 2,5,..,35; 3: 3,6,..,36) 2:1,
 *   red / black / even / odd / low (1-18) / high (19-36) 1:1.
 *   Zero loses every outside bet (no "la partage").
 * - A winning bet returns amount * (payout + 1) (stake included). Losing bets return 0.
 * - House edge is exactly 1/37 for every bet type.
 * - Red numbers: 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36.
 */
import type { Amount } from '../../money.ts';
import type { Rng } from '../../fair/rng.ts';

export const ROULETTE_INSIDE_TYPES = [
  'straight',
  'split',
  'street',
  'trio',
  'corner',
  'basket',
  'sixline',
] as const;
export const ROULETTE_INDEXED_TYPES = ['dozen', 'column'] as const;
export const ROULETTE_EVEN_TYPES = ['red', 'black', 'even', 'odd', 'low', 'high'] as const;
export const ROULETTE_BET_TYPES = [
  ...ROULETTE_INSIDE_TYPES,
  ...ROULETTE_INDEXED_TYPES,
  ...ROULETTE_EVEN_TYPES,
] as const;

export type RouletteInsideType = (typeof ROULETTE_INSIDE_TYPES)[number];
export type RouletteIndexedType = (typeof ROULETTE_INDEXED_TYPES)[number];
export type RouletteEvenType = (typeof ROULETTE_EVEN_TYPES)[number];
export type RouletteBetType = (typeof ROULETTE_BET_TYPES)[number];

export type RouletteBet =
  | { type: RouletteInsideType; numbers: number[]; amount: Amount }
  | { type: RouletteIndexedType; index: 1 | 2 | 3; amount: Amount }
  | { type: RouletteEvenType; amount: Amount };

/** Payout ratio "x to 1" per bet type. */
export const ROULETTE_PAYOUTS: Record<RouletteBetType, number> = {
  straight: 35,
  split: 17,
  street: 11,
  trio: 11,
  corner: 8,
  basket: 8,
  sixline: 5,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
};

export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

/** Wheel order of a European wheel, clockwise starting from 0 (for animation). */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export type RouletteColor = 'green' | 'red' | 'black';

export interface RouletteBetResult {
  bet: RouletteBet;
  /** Total returned for this bet (stake included), 0 if lost. */
  win: Amount;
}

export interface RouletteSettlement {
  number: number;
  color: RouletteColor;
  bets: RouletteBetResult[];
  totalBet: Amount;
  totalWin: Amount;
}

export function rouletteColor(n: number): RouletteColor {
  void n;
  throw new Error('not implemented');
}

/** Returns null when valid, or an Italian error message describing the problem. Validates shape, numbers and amount (positive safe integer). */
export function validateRouletteBet(bet: RouletteBet): string | null {
  void bet;
  throw new Error('not implemented');
}

/** Numbers covered by a (valid) bet, sorted ascending. */
export function coveredNumbers(bet: RouletteBet): number[] {
  void bet;
  throw new Error('not implemented');
}

/** Draws the winning pocket: exactly one rng.int(37) call. */
export function spinRoulette(rng: Rng): number {
  void rng;
  throw new Error('not implemented');
}

/** Settles already-validated bets against the winning number. */
export function settleRoulette(bets: RouletteBet[], number: number): RouletteSettlement {
  void bets;
  void number;
  throw new Error('not implemented');
}

/** Every valid combination of numbers for an inside bet type (sorted arrays), useful for the UI and tests. */
export function validInsideCombinations(type: RouletteInsideType): number[][] {
  void type;
  throw new Error('not implemented');
}
