import {
  blackjackActionCost,
  blackjackAllowedActions,
  blackjackApply,
  blackjackDeal,
  coveredNumbers,
  formatChips,
  IllegalBlackjackActionError,
  IllegalVideoPokerActionError,
  settleRoulette,
  settleSlot,
  spinRoulette,
  spinSlot,
  validateRouletteBet,
  videoPokerDeal,
  videoPokerDraw,
  type BlackjackState,
  type GameId,
  type RouletteBet,
  type VideoPokerState,
} from '@casino/engine';
import {
  blackjackActionRequestSchema,
  rouletteSpinRequestSchema,
  stakeRequestSchema,
  TABLE_LIMITS,
  videoPokerDrawRequestSchema,
  type OpenRoundResponse,
} from '@casino/shared';
import type { FastifyInstance } from 'fastify';
import { authOf } from '../auth/hooks.ts';
import type { AppContext } from '../context.ts';
import { apiError, parseWith } from '../lib/errors.ts';
import { parseId } from '../lib/util.ts';
import { assertLossLimits } from '../services/rg.ts';
import { assertNotSelfExcluded, assertSufficientFunds, getBalance } from '../services/wallet.ts';
import { requestHash, runStake, runStep } from '../games/flow.ts';
import {
  blackjackResponse,
  getOpenRound,
  rouletteResponse,
  slotResponse,
  videoPokerResponse,
  type BlackjackInput,
  type RoundRow,
  type VideoPokerInput,
} from '../games/rounds.ts';

function betLimitError(game: GameId) {
  const { min, maxPerBet } = TABLE_LIMITS[game];
  return apiError(
    'BET_LIMIT',
    `La puntata deve essere compresa tra ${formatChips(min)} e ${formatChips(maxPerBet)} fiches.`,
    { min, max: maxPerBet },
  );
}

/** Single-stake games: min..maxPerBet (whole chips are enforced by the zod schema too). */
function checkStake(game: GameId, amount: number): void {
  const { min, maxPerBet } = TABLE_LIMITS[game];
  if (amount < min || amount > maxPerBet || amount % 100 !== 0) throw betLimitError(game);
}

/** Layout validity, per-position maximum (identical positions are summed) and round total. */
export function checkRouletteBets(bets: RouletteBet[]): void {
  const { min, maxPerBet, maxPerRound } = TABLE_LIMITS.roulette;
  const byPosition = new Map<string, number>();
  let total = 0;
  bets.forEach((bet, index) => {
    const problem = validateRouletteBet(bet);
    if (problem !== null) throw apiError('BET_LIMIT', problem, { index });
    if (bet.amount < min || bet.amount % 100 !== 0) {
      throw apiError(
        'BET_LIMIT',
        `Ogni puntata deve essere di almeno ${formatChips(min)} fiches intere.`,
        { index, min },
      );
    }
    const key = `${bet.type}:${coveredNumbers(bet).join('-')}`;
    const onPosition = (byPosition.get(key) ?? 0) + bet.amount;
    if (onPosition > maxPerBet) {
      throw apiError(
        'BET_LIMIT',
        `Puntata massima su una singola posizione: ${formatChips(maxPerBet)} fiches.`,
        { index, maxPerBet },
      );
    }
    byPosition.set(key, onPosition);
    total += bet.amount;
  });
  if (total > maxPerRound) {
    throw apiError(
      'BET_LIMIT',
      `Puntata totale massima per giro: ${formatChips(maxPerRound)} fiches.`,
      { maxPerRound, total },
    );
  }
}

async function openRound<T>(
  ctx: AppContext,
  userId: number,
  game: GameId,
  respond: (row: RoundRow, balance: number) => T,
): Promise<OpenRoundResponse<T>> {
  const row = await getOpenRound(ctx.pool, userId, game);
  if (!row) return { round: null };
  return { round: respond(row, await getBalance(ctx.pool, userId)) };
}

export function gameRoutes(ctx: AppContext) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/games/roulette/spin', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(rouletteSpinRequestSchema, request.body);
      const bets = body.bets as RouletteBet[];
      return runStake(ctx, {
        userId,
        game: 'roulette',
        idempotencyKey: body.idempotencyKey,
        requestHash: requestHash('roulette/spin', body),
        // Only used after checkBet() has bounded the total by maxPerRound.
        stake: bets.reduce((sum, bet) => sum + bet.amount, 0),
        input: { bets },
        checkBet: () => {
          checkRouletteBets(bets);
        },
        play: (rng) => {
          const settlement = settleRoulette(bets, spinRoulette(rng));
          return { state: settlement, settled: true, payout: settlement.totalWin };
        },
        respond: rouletteResponse,
      });
    });

    app.post('/games/slot/spin', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(stakeRequestSchema, request.body);
      return runStake(ctx, {
        userId,
        game: 'slot',
        idempotencyKey: body.idempotencyKey,
        requestHash: requestHash('slot/spin', body),
        stake: body.amount,
        input: { bet: body.amount },
        checkBet: () => checkStake('slot', body.amount),
        play: (rng) => {
          const settlement = settleSlot(body.amount, spinSlot(rng));
          return { state: settlement, settled: true, payout: settlement.win };
        },
        respond: slotResponse,
      });
    });

    // ---- Blackjack ----------------------------------------------------------

    app.post('/games/blackjack/deal', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(stakeRequestSchema, request.body);
      const input: BlackjackInput = { bet: body.amount, actions: [] };
      return runStake(ctx, {
        userId,
        game: 'blackjack',
        idempotencyKey: body.idempotencyKey,
        requestHash: requestHash('blackjack/deal', body),
        stake: body.amount,
        input,
        checkBet: () => checkStake('blackjack', body.amount),
        play: (rng) => {
          const state = blackjackDeal(body.amount, rng);
          const settled = state.phase === 'settled';
          return { state, settled, payout: state.result?.totalPayout ?? 0 };
        },
        respond: blackjackResponse,
      });
    });

    app.post('/games/blackjack/action', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(blackjackActionRequestSchema, request.body);
      return runStep(ctx, {
        userId,
        game: 'blackjack',
        roundId: parseId(body.roundId),
        step: body.step,
        currentStep: (row) => (row.state as BlackjackState).step,
        respond: blackjackResponse,
        apply: async ({ client, user, row, balance, now }) => {
          const state = row.state as BlackjackState;
          let next: BlackjackState;
          try {
            next = blackjackApply(state, body.action);
          } catch (err) {
            if (err instanceof IllegalBlackjackActionError) {
              throw apiError('ILLEGAL_ACTION', err.message, {
                allowedActions: blackjackAllowedActions(state),
              });
            }
            throw err;
          }
          const cost = blackjackActionCost(state, body.action);
          if (cost > 0) {
            // Doubling/splitting adds chips: same checks as a new stake.
            assertNotSelfExcluded(user, now);
            const { maxPerRound } = TABLE_LIMITS.blackjack;
            if (row.stake + cost > maxPerRound) {
              throw apiError(
                'BET_LIMIT',
                `Puntata massima per mano: ${formatChips(maxPerRound)} fiches.`,
                { maxPerRound },
              );
            }
            assertSufficientFunds(balance, cost);
            await assertLossLimits(client, userId, cost, now);
          }
          const input = row.input as BlackjackInput;
          const settled = next.phase === 'settled';
          return {
            state: next,
            input: { bet: input.bet, actions: next.actions } satisfies BlackjackInput,
            settled,
            payout: next.result?.totalPayout ?? 0,
            extraStake: cost,
          };
        },
      });
    });

    app.get('/games/blackjack/open', async (request) =>
      openRound(ctx, authOf(request).userId, 'blackjack', blackjackResponse),
    );

    // ---- Video poker ----------------------------------------------------------

    app.post('/games/videopoker/deal', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(stakeRequestSchema, request.body);
      const input: VideoPokerInput = { bet: body.amount, held: null };
      return runStake(ctx, {
        userId,
        game: 'videopoker',
        idempotencyKey: body.idempotencyKey,
        requestHash: requestHash('videopoker/deal', body),
        stake: body.amount,
        input,
        checkBet: () => checkStake('videopoker', body.amount),
        play: (rng) => ({ state: videoPokerDeal(body.amount, rng), settled: false, payout: 0 }),
        respond: videoPokerResponse,
      });
    });

    app.post('/games/videopoker/draw', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(videoPokerDrawRequestSchema, request.body);
      return runStep(ctx, {
        userId,
        game: 'videopoker',
        roundId: parseId(body.roundId),
        step: body.step,
        currentStep: (row) => (row.state as VideoPokerState).step,
        respond: videoPokerResponse,
        apply: async ({ row }) => {
          let next: VideoPokerState;
          try {
            next = videoPokerDraw(row.state as VideoPokerState, body.held);
          } catch (err) {
            if (err instanceof IllegalVideoPokerActionError) {
              throw apiError('ILLEGAL_ACTION', err.message);
            }
            throw err;
          }
          const input = row.input as VideoPokerInput;
          return {
            state: next,
            input: { bet: input.bet, held: body.held } satisfies VideoPokerInput,
            settled: true,
            payout: next.result?.payout ?? 0,
            extraStake: 0,
          };
        },
      });
    });

    app.get('/games/videopoker/open', async (request) =>
      openRound(ctx, authOf(request).userId, 'videopoker', videoPokerResponse),
    );
  };
}
