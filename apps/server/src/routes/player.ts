import { STARTING_BALANCE } from '@casino/engine';
import {
  realityCheckRequestSchema,
  rotateSeedRequestSchema,
  selfExclusionRequestSchema,
  setLossLimitRequestSchema,
  type RealityCheckMinutes,
  type StatsResponse,
  type WalletResponse,
} from '@casino/shared';
import type { FastifyInstance } from 'fastify';
import { authOf } from '../auth/hooks.ts';
import type { AppContext } from '../context.ts';
import { withTransaction } from '../db/tx.ts';
import { apiError, parseWith } from '../lib/errors.ts';
import { getFairness, rotateSeedPair } from '../services/fairness.ts';
import { extendSelfExclusion, rgStatus, setLossLimit, setRealityCheck } from '../services/rg.ts';
import { resetCount, settledStats } from '../services/stats.ts';
import { applyMovement, getBalance, lockUser } from '../services/wallet.ts';

/** Wallet, provably-fair seeds, responsible gaming and statistics (authenticated). */
export function playerRoutes(ctx: AppContext) {
  const { pool } = ctx;

  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/wallet', async (request): Promise<WalletResponse> => {
      return { balance: await getBalance(pool, authOf(request).userId) };
    });

    app.post('/wallet/reset', async (request): Promise<WalletResponse> => {
      const { userId } = authOf(request);
      const balance = await withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const current = await getBalance(client, userId);
        const open = await client.query(
          `SELECT 1 FROM rounds WHERE user_id = $1 AND status = 'open' LIMIT 1`,
          [userId],
        );
        if (current >= STARTING_BALANCE) {
          throw apiError(
            'RESET_NOT_ALLOWED',
            'Puoi ricominciare solo quando il saldo è inferiore a quello iniziale.',
          );
        }
        if (open.rowCount) {
          throw apiError('RESET_NOT_ALLOWED', 'Completa prima la mano in corso.');
        }
        return applyMovement(client, {
          userId,
          roundId: null,
          kind: 'reset',
          amount: STARTING_BALANCE - current,
          now: ctx.now(),
        });
      });
      return { balance };
    });

    app.get('/fairness', async (request) => getFairness(pool, authOf(request).userId));

    app.post('/fairness/rotate', async (request) => {
      const { userId } = authOf(request);
      const body = parseWith(rotateSeedRequestSchema, request.body ?? {});
      return withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const open = await client.query<{ id: number }>(
          `SELECT id FROM rounds WHERE user_id = $1 AND status = 'open' ORDER BY id LIMIT 1`,
          [userId],
        );
        if (open.rows[0]) {
          throw apiError('SEED_ROTATION_BLOCKED', undefined, { roundId: String(open.rows[0].id) });
        }
        await rotateSeedPair(client, userId, body.clientSeed, ctx.now());
        return getFairness(client, userId);
      });
    });

    app.get('/rg', async (request) => {
      const auth = authOf(request);
      return rgStatus(pool, auth.userId, auth.sessionStartedAt, ctx.now());
    });

    app.put('/rg/loss-limit', async (request) => {
      const auth = authOf(request);
      const body = parseWith(setLossLimitRequestSchema, request.body);
      return withTransaction(pool, async (client) => {
        const now = ctx.now();
        await lockUser(client, auth.userId);
        await setLossLimit(client, auth.userId, body.period, body.value, now);
        return rgStatus(client, auth.userId, auth.sessionStartedAt, now);
      });
    });

    app.post('/rg/self-exclusion', async (request) => {
      const auth = authOf(request);
      const body = parseWith(selfExclusionRequestSchema, request.body);
      return withTransaction(pool, async (client) => {
        const now = ctx.now();
        await lockUser(client, auth.userId);
        await extendSelfExclusion(client, auth.userId, body.duration, now);
        return rgStatus(client, auth.userId, auth.sessionStartedAt, now);
      });
    });

    app.put('/rg/reality-check', async (request) => {
      const auth = authOf(request);
      const body = parseWith(realityCheckRequestSchema, request.body);
      await setRealityCheck(pool, auth.userId, body.minutes as RealityCheckMinutes);
      return rgStatus(pool, auth.userId, auth.sessionStartedAt, ctx.now());
    });

    app.get('/stats', async (request): Promise<StatsResponse> => {
      const auth = authOf(request);
      const lifetime = await settledStats(pool, auth.userId);
      const session = await settledStats(pool, auth.userId, auth.sessionStartedAt);
      return {
        lifetime: lifetime.total,
        byGame: lifetime.byGame,
        session: { ...session.total, startedAt: auth.sessionStartedAt.toISOString() },
        resets: await resetCount(pool, auth.userId),
      };
    });
  };
}
