import { describe, expect, it } from 'vitest';
import { createSeededTestRng } from '../src/fair/rng.ts';
import {
  blackjackApply,
  blackjackBasicStrategy,
  blackjackDeal,
  blackjackTotalStake,
} from '../src/games/blackjack/index.ts';

describe('blackjack long-run return with basic strategy', () => {
  it('RTP of a seeded 200k-round simulation is within [0.985, 1.005]', () => {
    const rounds = 200_000;
    const bet = 100;
    const rng = createSeededTestRng(20260925);
    let staked = 0;
    let returned = 0;
    for (let i = 0; i < rounds; i++) {
      let state = blackjackDeal(bet, rng);
      while (state.phase === 'player') {
        state = blackjackApply(state, blackjackBasicStrategy(state)!);
      }
      staked += blackjackTotalStake(state);
      returned += state.result!.totalPayout;
    }
    const rtp = returned / staked;
    const perInitialBet = 1 + (returned - staked) / (rounds * bet);
    console.log(
      `blackjack basic strategy, ${rounds} rounds: RTP (payout/stake) = ${rtp.toFixed(5)}, ` +
        `return per initial bet = ${perInitialBet.toFixed(5)}`,
    );
    expect(rtp).toBeGreaterThanOrEqual(0.985);
    expect(rtp).toBeLessThanOrEqual(1.005);
    expect(perInitialBet).toBeGreaterThanOrEqual(0.985);
    expect(perInitialBet).toBeLessThanOrEqual(1.005);
  }, 30_000);
});
