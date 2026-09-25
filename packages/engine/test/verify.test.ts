import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRoundRng, hashServerSeed, type SeedTriple } from '../src/fair/rng.ts';
import { settleRoulette, spinRoulette, type RouletteBet } from '../src/games/roulette/index.ts';
import { settleSlot, spinSlot } from '../src/games/slot/index.ts';
import {
  blackjackApply,
  blackjackBasicStrategy,
  blackjackDeal,
} from '../src/games/blackjack/index.ts';
import { videoPokerDeal, videoPokerDraw } from '../src/games/videopoker/index.ts';
import { verifyRound, verifyServerSeedHash } from '../src/verify.ts';

const seedArb = fc.record({
  serverSeed: fc.stringMatching(/^[0-9a-f]{64}$/),
  clientSeed: fc.stringMatching(/^[\x21-\x39\x3b-\x7e]{1,64}$/),
  nonce: fc.nat({ max: 1_000_000 }),
});

describe('verifyRound', () => {
  it('roulette equals settleRoulette(spinRoulette(createRoundRng))', () => {
    const bets: RouletteBet[] = [
      { type: 'straight', numbers: [7], amount: 100 },
      { type: 'red', amount: 500 },
      { type: 'column', index: 2, amount: 200 },
    ];
    fc.assert(
      fc.property(seedArb, (seeds: SeedTriple) => {
        const direct = settleRoulette(bets, spinRoulette(createRoundRng(seeds)));
        expect(verifyRound(seeds, { game: 'roulette', bets })).toEqual({
          game: 'roulette',
          settlement: direct,
        });
      }),
      { numRuns: 50 },
    );
  });

  it('slot equals settleSlot(spinSlot(createRoundRng))', () => {
    fc.assert(
      fc.property(seedArb, (seeds: SeedTriple) => {
        const direct = settleSlot(300, spinSlot(createRoundRng(seeds)));
        expect(verifyRound(seeds, { game: 'slot', bet: 300 })).toEqual({
          game: 'slot',
          settlement: direct,
        });
      }),
      { numRuns: 50 },
    );
  });

  it('blackjack reproduces a round played with the same seeds and actions', () => {
    fc.assert(
      fc.property(seedArb, (seeds: SeedTriple) => {
        let state = blackjackDeal(1000, createRoundRng(seeds));
        while (state.phase === 'player') {
          state = blackjackApply(state, blackjackBasicStrategy(state)!);
        }
        expect(
          verifyRound(seeds, { game: 'blackjack', bet: 1000, actions: state.actions }),
        ).toEqual({ game: 'blackjack', state });
      }),
      { numRuns: 50 },
    );
  });

  it('video poker reproduces deal + draw with the same seeds and hold mask', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (seeds, held) => {
          const direct = videoPokerDraw(videoPokerDeal(500, createRoundRng(seeds)), held);
          expect(verifyRound(seeds, { game: 'videopoker', bet: 500, held })).toEqual({
            game: 'videopoker',
            state: direct,
          });
        },
      ),
      { numRuns: 50 },
    );
  });

  it('different nonces give independent rounds', () => {
    const base = { serverSeed: 'b'.repeat(64), clientSeed: 'client', nonce: 0 };
    const numbers = new Set<number>();
    for (let nonce = 0; nonce < 50; nonce++) {
      const result = verifyRound({ ...base, nonce }, { game: 'roulette', bets: [] });
      if (result.game === 'roulette') numbers.add(result.settlement.number);
    }
    expect(numbers.size).toBeGreaterThan(10);
  });
});

describe('verifyServerSeedHash', () => {
  it('accepts the matching commitment in any case and rejects others', () => {
    const seed = 'a1'.repeat(32);
    const hash = hashServerSeed(seed);
    expect(verifyServerSeedHash(seed, hash)).toBe(true);
    expect(verifyServerSeedHash(seed, hash.toUpperCase())).toBe(true);
    expect(verifyServerSeedHash('b2'.repeat(32), hash)).toBe(false);
  });
});
