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

/** The reel strip (length 20), identical for the three reels. Implementer defines the order. */
export const SLOT_STRIP: readonly SlotSymbol[] = [];

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

/** Exactly three rng.int(20) calls, reel 0 first. */
export function spinSlot(rng: Rng): SlotStops {
  void rng;
  throw new Error('not implemented');
}

export function evaluateSlot(stops: SlotStops): SlotOutcome {
  void stops;
  throw new Error('not implemented');
}

export function settleSlot(bet: Amount, stops: SlotStops): SlotSettlement {
  void bet;
  void stops;
  throw new Error('not implemented');
}

/** Exact RTP and hit rate by enumerating all 8000 stop combinations. */
export function slotExactStats(): {
  combinations: number;
  totalReturn: number;
  rtp: number;
  hitRate: number;
} {
  throw new Error('not implemented');
}
