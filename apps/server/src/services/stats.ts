import { GAME_IDS, type GameId } from '@casino/engine';
import type { GameStats } from '@casino/shared';
import type { Queryable } from '../db/pool.ts';

export function emptyStats(): GameStats {
  return { rounds: 0, wagered: 0, returned: 0, net: 0 };
}

function addStats(a: GameStats, b: GameStats): GameStats {
  const wagered = a.wagered + b.wagered;
  const returned = a.returned + b.returned;
  return { rounds: a.rounds + b.rounds, wagered, returned, net: returned - wagered };
}

/**
 * Totals over SETTLED rounds (an open hand has no result yet).
 * With `since`, only rounds settled at or after that instant (the login session).
 */
export async function settledStats(
  db: Queryable,
  userId: number,
  since: Date | null = null,
): Promise<{ total: GameStats; byGame: Record<GameId, GameStats> }> {
  const { rows } = await db.query<{
    game: GameId;
    rounds: number;
    wagered: number;
    returned: number;
  }>(
    `SELECT game, COUNT(*) AS rounds,
            COALESCE(SUM(stake), 0)::bigint AS wagered,
            COALESCE(SUM(payout), 0)::bigint AS returned
       FROM rounds
      WHERE user_id = $1 AND status = 'settled' AND ($2::timestamptz IS NULL OR settled_at >= $2)
      GROUP BY game`,
    [userId, since],
  );
  const byGame = Object.fromEntries(GAME_IDS.map((g) => [g, emptyStats()])) as Record<
    GameId,
    GameStats
  >;
  let total = emptyStats();
  for (const row of rows) {
    const stats: GameStats = {
      rounds: row.rounds,
      wagered: row.wagered,
      returned: row.returned,
      net: row.returned - row.wagered,
    };
    byGame[row.game] = stats;
    total = addStats(total, stats);
  }
  return { total, byGame };
}

export async function resetCount(db: Queryable, userId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ledger WHERE user_id = $1 AND kind = 'reset'`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}
