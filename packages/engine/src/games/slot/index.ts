/**
 * "Frutta" — classic 3-reel, 1-payline slot. CONTRACT FILE: exported names and
 * semantics are relied upon by the server and the web app.
 *
 * Each reel is a strip of 20 positions with the same symbol counts:
 *   SEVEN x1, BAR x2, BELL x3, CHERRY x4, LEMON x5, ORANGE x5
 * (the order on the strip only matters for what is displayed above/below the line;
 * use a fixed, spread-out order and the same strip for all three reels).
 *
 * A spin draws one stop per reel: stops[i] = rng.int(20), reels 0,1,2 in order.
 * The payline is the symbol at each stop. The rows shown are (stop-1, stop, stop+1) mod 20.
 *
 * Paytable (total return as a multiple of the bet, stake included):
 *   SEVEN SEVEN SEVEN 100 | BAR x3 40 | BELL x3 20 | CHERRY x3 15 | LEMON x3 10 | ORANGE x3 10
 *   exactly two CHERRY (any positions) 4
 *   anything else 0
 * Exact RTP = 7492/8000 = 93.65%, hit frequency = 1118/8000 = 13.975% (verified by enumeration).
 *
 * No near-miss manipulation: the display always shows the drawn stops.
 */
import type { Amount } from '../../money.ts';
import type { Rng } from '../../fair/rng.ts';

export const SLOT_SYMBOLS = ['SEVEN', 'BAR', 'BELL', 'CHERRY', 'LEMON', 'ORANGE'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

export const SLOT_STRIP_LENGTH = 20;

export type SlotWinKind =
  | 'THREE_SEVEN'
  | 'THREE_BAR'
  | 'THREE_BELL'
  | 'THREE_CHERRY'
  | 'THREE_LEMON'
  | 'THREE_ORANGE'
  | 'TWO_CHERRY';

export const SLOT_PAYTABLE: Record<SlotWinKind, number> = {
  THREE_SEVEN: 100,
  THREE_BAR: 40,
  THREE_BELL: 20,
  THREE_CHERRY: 15,
  THREE_LEMON: 10,
  THREE_ORANGE: 10,
  TWO_CHERRY: 4,
};

/**
 * The reel strip (length 20), identical for the three reels. LEMON and ORANGE alternate on the
 * even positions; the rarer symbols sit on the odd positions, spread out so that no symbol is
 * ever next to itself (wrap-around included).
 */
export const SLOT_STRIP: readonly SlotSymbol[] = [
  'LEMON', // 0
  'CHERRY', // 1
  'ORANGE', // 2
  'BELL', // 3
  'LEMON', // 4
  'BAR', // 5
  'ORANGE', // 6
  'CHERRY', // 7
  'LEMON', // 8
  'BELL', // 9
  'ORANGE', // 10
  'SEVEN', // 11
  'LEMON', // 12
  'CHERRY', // 13
  'ORANGE', // 14
  'BAR', // 15
  'LEMON', // 16
  'CHERRY', // 17
  'ORANGE', // 18
  'BELL', // 19
];

export type SlotStops = [number, number, number];

export interface SlotOutcome {
  stops: SlotStops;
  /** window[row][reel]; row 0 = above the line, 1 = payline, 2 = below. */
  window: SlotSymbol[][];
  line: [SlotSymbol, SlotSymbol, SlotSymbol];
  kind: SlotWinKind | null;
  /** Total return multiple (0 when losing). */
  multiplier: number;
}

export interface SlotSettlement extends SlotOutcome {
  bet: Amount;
  /** Total returned, stake included (bet * multiplier). */
  win: Amount;
}

const THREE_OF: Record<SlotSymbol, SlotWinKind> = {
  SEVEN: 'THREE_SEVEN',
  BAR: 'THREE_BAR',
  BELL: 'THREE_BELL',
  CHERRY: 'THREE_CHERRY',
  LEMON: 'THREE_LEMON',
  ORANGE: 'THREE_ORANGE',
};

function isStop(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SLOT_STRIP_LENGTH
  );
}

function symbolAt(position: number): SlotSymbol {
  const index = ((position % SLOT_STRIP_LENGTH) + SLOT_STRIP_LENGTH) % SLOT_STRIP_LENGTH;
  return SLOT_STRIP[index]!;
}

/** Winning combination on the payline, or null. */
export function slotWinKind(line: readonly SlotSymbol[]): SlotWinKind | null {
  const [a, b, c] = line;
  if (a === undefined || b === undefined || c === undefined) return null;
  if (a === b && b === c) return THREE_OF[a];
  const cherries = (a === 'CHERRY' ? 1 : 0) + (b === 'CHERRY' ? 1 : 0) + (c === 'CHERRY' ? 1 : 0);
  return cherries === 2 ? 'TWO_CHERRY' : null;
}

/** Exactly three rng.int(20) calls, reel 0 first. */
export function spinSlot(rng: Rng): SlotStops {
  const reel0 = rng.int(SLOT_STRIP_LENGTH);
  const reel1 = rng.int(SLOT_STRIP_LENGTH);
  const reel2 = rng.int(SLOT_STRIP_LENGTH);
  return [reel0, reel1, reel2];
}

export function evaluateSlot(stops: SlotStops): SlotOutcome {
  if (!Array.isArray(stops) || stops.length !== 3 || !stops.every(isStop)) {
    throw new RangeError(`Fermate dei rulli non valide: ${JSON.stringify(stops)}`);
  }
  const window: SlotSymbol[][] = [-1, 0, 1].map((offset) =>
    stops.map((stop) => symbolAt(stop + offset)),
  );
  const line: [SlotSymbol, SlotSymbol, SlotSymbol] = [
    symbolAt(stops[0]),
    symbolAt(stops[1]),
    symbolAt(stops[2]),
  ];
  const kind = slotWinKind(line);
  return {
    stops: [stops[0], stops[1], stops[2]],
    window,
    line,
    kind,
    multiplier: kind === null ? 0 : SLOT_PAYTABLE[kind],
  };
}

export function settleSlot(bet: Amount, stops: SlotStops): SlotSettlement {
  if (!Number.isSafeInteger(bet) || bet <= 0) {
    throw new RangeError(`Puntata non valida: ${bet}`);
  }
  const outcome = evaluateSlot(stops);
  return { ...outcome, bet, win: bet * outcome.multiplier };
}

/** Exact RTP and hit rate by enumerating all 8000 stop combinations. */
export function slotExactStats(): {
  combinations: number;
  totalReturn: number;
  rtp: number;
  hitRate: number;
} {
  let combinations = 0;
  let totalReturn = 0;
  let hits = 0;
  for (let a = 0; a < SLOT_STRIP_LENGTH; a++) {
    for (let b = 0; b < SLOT_STRIP_LENGTH; b++) {
      for (let c = 0; c < SLOT_STRIP_LENGTH; c++) {
        const kind = slotWinKind([SLOT_STRIP[a]!, SLOT_STRIP[b]!, SLOT_STRIP[c]!]);
        combinations++;
        if (kind !== null) {
          hits++;
          totalReturn += SLOT_PAYTABLE[kind];
        }
      }
    }
  }
  return {
    combinations,
    totalReturn,
    rtp: totalReturn / combinations,
    hitRate: hits / combinations,
  };
}
