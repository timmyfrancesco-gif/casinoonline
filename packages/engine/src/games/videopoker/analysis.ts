/**
 * Exact hold analysis: for each of the 32 hold masks, enumerate every possible draw from
 * the 47 unseen cards (C(47, k) for k replaced cards, about 2.6M hands in total).
 */
import type { CardCode } from '../../cards.ts';
import { evaluateRankIndex } from './evaluate.ts';

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

export interface HoldTotal {
  /** Bit i set = card i held. */
  mask: number;
  /** Sum of payout multiples over every possible draw. */
  total: number;
  /** Number of possible draws (C(47, replaced)). */
  draws: number;
}

/** pay[rankIndex] is the multiple for the POKER_HAND_RANKS entry at that index. */
export function holdTotals(hand: readonly CardCode[], pay: readonly number[]): HoldTotal[] {
  const payTable = Int32Array.from(pay);
  const inHand = new Set(hand);
  const rest: number[] = [];
  for (let code = 0; code < 52; code++) if (!inHand.has(code)) rest.push(code);
  const r = Int32Array.from(rest);
  const n = r.length;

  const totals: HoldTotal[] = [];
  for (let mask = 0; mask < 32; mask++) {
    const held: number[] = [];
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) held.push(hand[i]!);
    const [h0 = 0, h1 = 0, h2 = 0, h3 = 0] = held;
    const replaced = 5 - held.length;
    let total = 0;
    switch (replaced) {
      case 0:
        total = payTable[evaluateRankIndex(h0, h1, h2, h3, held[4]!)]!;
        break;
      case 1:
        for (let a = 0; a < n; a++) total += payTable[evaluateRankIndex(h0, h1, h2, h3, r[a]!)]!;
        break;
      case 2:
        for (let a = 0; a < n; a++) {
          const ca = r[a]!;
          for (let b = a + 1; b < n; b++) {
            total += payTable[evaluateRankIndex(h0, h1, h2, ca, r[b]!)]!;
          }
        }
        break;
      case 3:
        for (let a = 0; a < n; a++) {
          const ca = r[a]!;
          for (let b = a + 1; b < n; b++) {
            const cb = r[b]!;
            for (let c = b + 1; c < n; c++) {
              total += payTable[evaluateRankIndex(h0, h1, ca, cb, r[c]!)]!;
            }
          }
        }
        break;
      case 4:
        for (let a = 0; a < n; a++) {
          const ca = r[a]!;
          for (let b = a + 1; b < n; b++) {
            const cb = r[b]!;
            for (let c = b + 1; c < n; c++) {
              const cc = r[c]!;
              for (let d = c + 1; d < n; d++) {
                total += payTable[evaluateRankIndex(h0, ca, cb, cc, r[d]!)]!;
              }
            }
          }
        }
        break;
      default:
        for (let a = 0; a < n; a++) {
          const ca = r[a]!;
          for (let b = a + 1; b < n; b++) {
            const cb = r[b]!;
            for (let c = b + 1; c < n; c++) {
              const cc = r[c]!;
              for (let d = c + 1; d < n; d++) {
                const cd = r[d]!;
                for (let e = d + 1; e < n; e++) {
                  total += payTable[evaluateRankIndex(ca, cb, cc, cd, r[e]!)]!;
                }
              }
            }
          }
        }
    }
    totals.push({ mask, total, draws: binomial(n, replaced) });
  }
  return totals;
}

/** Orders by exact EV (cross-multiplied integers), then more held cards, then mask. */
export function compareHoldTotals(x: HoldTotal, y: HoldTotal): number {
  const diff = y.total * x.draws - x.total * y.draws;
  if (diff !== 0) return diff;
  const heldDiff = popcount5(y.mask) - popcount5(x.mask);
  return heldDiff !== 0 ? heldDiff : x.mask - y.mask;
}

function popcount5(mask: number): number {
  let count = 0;
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) count++;
  return count;
}
