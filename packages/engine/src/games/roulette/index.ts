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

/** Italian names of the bet types (UI labels and validation messages). */
export const ROULETTE_BET_NAMES_IT: Record<RouletteBetType, string> = {
  straight: 'pieno',
  split: 'cavallo',
  street: 'terzina',
  trio: 'terzina con lo zero',
  corner: 'carré',
  basket: 'quartina (0-1-2-3)',
  sixline: 'sestina',
  dozen: 'dozzina',
  column: 'colonna',
  red: 'rosso',
  black: 'nero',
  even: 'pari',
  odd: 'dispari',
  low: 'manque (1-18)',
  high: 'passe (19-36)',
};

/** How many numbers each inside bet type covers. */
export const ROULETTE_INSIDE_SIZES: Record<RouletteInsideType, number> = {
  straight: 1,
  split: 2,
  street: 3,
  trio: 3,
  corner: 4,
  basket: 4,
  sixline: 6,
};

const RED_SET: ReadonlySet<number> = new Set(RED_NUMBERS);

function isPocket(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 36;
}

export function rouletteColor(n: number): RouletteColor {
  if (!isPocket(n)) throw new RangeError(`Numero della roulette non valido: ${n}`);
  if (n === 0) return 'green';
  return RED_SET.has(n) ? 'red' : 'black';
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

function buildInsideCombinations(): Record<RouletteInsideType, number[][]> {
  const straight = range(0, 36).map((n) => [n]);
  const split: number[][] = [
    [0, 1],
    [0, 2],
    [0, 3],
  ];
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) split.push([n, n + 1]);
    if (n + 3 <= 36) split.push([n, n + 3]);
  }
  const street: number[][] = [];
  const sixline: number[][] = [];
  for (let first = 1; first <= 34; first += 3) {
    street.push([first, first + 1, first + 2]);
    if (first + 5 <= 36) sixline.push(range(first, first + 5));
  }
  const corner: number[][] = [];
  for (let n = 1; n + 4 <= 36; n++) {
    if (n % 3 !== 0) corner.push([n, n + 1, n + 3, n + 4]);
  }
  const byLex = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i]! - b[i]!;
    }
    return a.length - b.length;
  };
  return {
    straight,
    split: split.sort(byLex),
    street,
    trio: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    corner: corner.sort(byLex),
    basket: [[0, 1, 2, 3]],
    sixline,
  };
}

const INSIDE_COMBINATIONS = buildInsideCombinations();

const comboKey = (sorted: readonly number[]): string => sorted.join(',');

const INSIDE_KEYS = {} as Record<RouletteInsideType, ReadonlySet<string>>;
for (const type of ROULETTE_INSIDE_TYPES) {
  INSIDE_KEYS[type] = new Set(INSIDE_COMBINATIONS[type].map(comboKey));
}

const INSIDE_ERRORS: Record<RouletteInsideType, string> = {
  straight: 'Il pieno deve coprire un numero da 0 a 36.',
  split: 'I due numeri del cavallo devono essere adiacenti sul tappeto.',
  street: 'La terzina deve coprire una riga del tappeto (es. 1-2-3).',
  trio: 'La terzina con lo zero può essere solo 0-1-2 oppure 0-2-3.',
  corner: 'Il carré deve coprire quattro numeri che formano un quadrato sul tappeto.',
  basket: 'La quartina deve coprire esattamente 0-1-2-3.',
  sixline: 'La sestina deve coprire due righe adiacenti del tappeto (es. 1-6).',
};

function includesValue<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** Returns null when valid, or an Italian error message describing the problem. Validates shape, numbers and amount (positive safe integer). */
export function validateRouletteBet(bet: RouletteBet): string | null {
  if (typeof bet !== 'object' || bet === null || Array.isArray(bet)) {
    return 'Puntata non valida.';
  }
  const raw = bet as unknown as Record<string, unknown>;
  const type = raw.type;
  if (!includesValue(ROULETTE_BET_TYPES, type)) return 'Tipo di puntata sconosciuto.';
  const amount = raw.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return "L'importo della puntata deve essere un numero intero positivo.";
  }
  if (includesValue(ROULETTE_INSIDE_TYPES, type)) {
    const numbers = raw.numbers;
    if (!Array.isArray(numbers)) return 'La puntata deve indicare i numeri coperti.';
    if (!numbers.every(isPocket)) return 'I numeri devono essere interi da 0 a 36.';
    const size = ROULETTE_INSIDE_SIZES[type];
    if (numbers.length !== size) {
      return size === 1
        ? 'Il pieno richiede esattamente 1 numero.'
        : `La puntata "${ROULETTE_BET_NAMES_IT[type]}" richiede esattamente ${size} numeri.`;
    }
    if (new Set(numbers).size !== numbers.length) return 'La puntata contiene numeri ripetuti.';
    const sorted = [...numbers].sort((a, b) => a - b);
    if (!INSIDE_KEYS[type].has(comboKey(sorted))) return INSIDE_ERRORS[type];
    return null;
  }
  if (includesValue(ROULETTE_INDEXED_TYPES, type)) {
    const index = raw.index;
    if (index !== 1 && index !== 2 && index !== 3) {
      return `L'indice della ${ROULETTE_BET_NAMES_IT[type]} deve essere 1, 2 o 3.`;
    }
  }
  return null;
}

const EVEN_MONEY_NUMBERS: Record<RouletteEvenType, readonly number[]> = {
  red: [...RED_NUMBERS].sort((a, b) => a - b),
  black: range(1, 36).filter((n) => !RED_SET.has(n)),
  even: range(1, 36).filter((n) => n % 2 === 0),
  odd: range(1, 36).filter((n) => n % 2 === 1),
  low: range(1, 18),
  high: range(19, 36),
};

/** Numbers covered by a (valid) bet, sorted ascending. */
export function coveredNumbers(bet: RouletteBet): number[] {
  switch (bet.type) {
    case 'dozen': {
      const first = (bet.index - 1) * 12 + 1;
      return range(first, first + 11);
    }
    case 'column':
      return range(1, 36).filter((n) => (n - bet.index) % 3 === 0);
    case 'red':
    case 'black':
    case 'even':
    case 'odd':
    case 'low':
    case 'high':
      return [...EVEN_MONEY_NUMBERS[bet.type]];
    default:
      return [...bet.numbers].sort((a, b) => a - b);
  }
}

/** Draws the winning pocket: exactly one rng.int(37) call. */
export function spinRoulette(rng: Rng): number {
  return rng.int(37);
}

function copyBet(bet: RouletteBet): RouletteBet {
  return 'numbers' in bet ? { ...bet, numbers: [...bet.numbers] } : { ...bet };
}

/** Settles already-validated bets against the winning number. */
export function settleRoulette(bets: RouletteBet[], number: number): RouletteSettlement {
  const color = rouletteColor(number);
  let totalBet = 0;
  let totalWin = 0;
  const results: RouletteBetResult[] = bets.map((bet) => {
    const win = coveredNumbers(bet).includes(number)
      ? bet.amount * (ROULETTE_PAYOUTS[bet.type] + 1)
      : 0;
    totalBet += bet.amount;
    totalWin += win;
    return { bet: copyBet(bet), win };
  });
  return { number, color, bets: results, totalBet, totalWin };
}

/** Every valid combination of numbers for an inside bet type (sorted arrays), useful for the UI and tests. */
export function validInsideCombinations(type: RouletteInsideType): number[][] {
  return INSIDE_COMBINATIONS[type].map((combo) => [...combo]);
}
