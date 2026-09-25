/**
 * Independent re-computation of a round from its seeds. Used by the in-browser verifier
 * and by server tests: given the revealed server seed, the client seed, the nonce and the
 * player's inputs, it must reproduce exactly what the server settled.
 */
import type { Amount } from './money.ts';
import { createRoundRng, hashServerSeed, type SeedTriple } from './fair/rng.ts';
import {
  settleRoulette,
  spinRoulette,
  type RouletteBet,
  type RouletteSettlement,
} from './games/roulette/index.ts';
import { settleSlot, spinSlot, type SlotSettlement } from './games/slot/index.ts';
import {
  blackjackReplay,
  type BlackjackAction,
  type BlackjackState,
} from './games/blackjack/index.ts';
import { videoPokerReplay, type VideoPokerState } from './games/videopoker/index.ts';

export type VerifyInput =
  | { game: 'roulette'; bets: RouletteBet[] }
  | { game: 'slot'; bet: Amount }
  | { game: 'blackjack'; bet: Amount; actions: BlackjackAction[] }
  | { game: 'videopoker'; bet: Amount; held: boolean[] };

export type VerifyResult =
  | { game: 'roulette'; settlement: RouletteSettlement }
  | { game: 'slot'; settlement: SlotSettlement }
  | { game: 'blackjack'; state: BlackjackState }
  | { game: 'videopoker'; state: VideoPokerState };

export function verifyRound(seeds: SeedTriple, input: VerifyInput): VerifyResult {
  const rng = createRoundRng(seeds);
  switch (input.game) {
    case 'roulette':
      return { game: 'roulette', settlement: settleRoulette(input.bets, spinRoulette(rng)) };
    case 'slot':
      return { game: 'slot', settlement: settleSlot(input.bet, spinSlot(rng)) };
    case 'blackjack':
      return { game: 'blackjack', state: blackjackReplay(input.bet, rng, input.actions) };
    case 'videopoker':
      return { game: 'videopoker', state: videoPokerReplay(input.bet, rng, input.held) };
  }
}

/** True when the revealed server seed matches the commitment shown before play. */
export function verifyServerSeedHash(serverSeed: string, expectedHash: string): boolean {
  return hashServerSeed(serverSeed) === expectedHash.toLowerCase();
}
