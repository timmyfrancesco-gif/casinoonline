import {
  blackjackPublicView,
  handValue,
  videoPokerPublicView,
  VIDEO_POKER_HAND_NAMES_IT,
  type BlackjackAction,
  type BlackjackState,
  type GameId,
  type RouletteBet,
  type RouletteColor,
  type RouletteSettlement,
  type SlotSettlement,
  type SlotWinKind,
  type VerifyInput,
  type VideoPokerState,
} from '@casino/engine';
import type {
  BlackjackRoundResponse,
  HistoryItem,
  RoundDetailData,
  RoundDetailResponse,
  RoundStatus,
  RoundSummary,
  RouletteSpinResponse,
  SlotSpinResponse,
  VideoPokerRoundResponse,
} from '@casino/shared';
import type { PoolClient, Queryable } from '../db/pool.ts';
import { iso, isoOrNull } from '../lib/util.ts';

/** Stored `rounds.input` per game (maps 1:1 onto the engine's VerifyInput). */
export type RouletteInput = { bets: RouletteBet[] };
export type SlotInput = { bet: number };
export type BlackjackInput = { bet: number; actions: BlackjackAction[] };
export type VideoPokerInput = { bet: number; held: boolean[] | null };

/** A round joined with its seed pair. `server_seed` must never leave the server unless revealed. */
export interface RoundRow {
  id: number;
  user_id: number;
  game: GameId;
  status: RoundStatus;
  seed_pair_id: number;
  nonce: number;
  stake: number;
  payout: number;
  input: unknown;
  state: unknown;
  idempotency_key: string;
  request_hash: string;
  created_at: Date;
  settled_at: Date | null;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  revealed_at: Date | null;
}

export const ROUND_SELECT = `
  SELECT r.id, r.user_id, r.game, r.status, r.seed_pair_id, r.nonce, r.stake, r.payout,
         r.input, r.state, r.idempotency_key, r.request_hash, r.created_at, r.settled_at,
         sp.server_seed, sp.server_seed_hash, sp.client_seed, sp.revealed_at
    FROM rounds r
    JOIN seed_pairs sp ON sp.id = r.seed_pair_id`;

export async function getRound(
  db: Queryable,
  userId: number,
  roundId: number,
): Promise<RoundRow | null> {
  const { rows } = await db.query<RoundRow>(`${ROUND_SELECT} WHERE r.id = $1 AND r.user_id = $2`, [
    roundId,
    userId,
  ]);
  return rows[0] ?? null;
}

/** Locks a round of the user (after the user lock). */
export async function lockRound(
  client: PoolClient,
  userId: number,
  roundId: number,
): Promise<RoundRow | null> {
  const { rows } = await client.query<RoundRow>(
    `${ROUND_SELECT} WHERE r.id = $1 AND r.user_id = $2 FOR UPDATE OF r`,
    [roundId, userId],
  );
  return rows[0] ?? null;
}

export async function getOpenRound(
  db: Queryable,
  userId: number,
  game: GameId,
): Promise<RoundRow | null> {
  const { rows } = await db.query<RoundRow>(
    `${ROUND_SELECT} WHERE r.user_id = $1 AND r.game = $2 AND r.status = 'open'`,
    [userId, game],
  );
  return rows[0] ?? null;
}

export function roundSummary(row: RoundRow): RoundSummary {
  return {
    id: String(row.id),
    game: row.game,
    status: row.status,
    stake: row.stake,
    payout: row.payout,
    createdAt: iso(row.created_at),
    settledAt: isoOrNull(row.settled_at),
    fairness: {
      seedPairId: String(row.seed_pair_id),
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: row.nonce,
      serverSeed: row.revealed_at === null ? null : row.server_seed,
    },
  };
}

export function rouletteResponse(row: RoundRow, balance: number): RouletteSpinResponse {
  return {
    round: roundSummary(row),
    settlement: row.state as RouletteSettlement,
    balance,
  };
}

export function slotResponse(row: RoundRow, balance: number): SlotSpinResponse {
  return { round: roundSummary(row), settlement: row.state as SlotSettlement, balance };
}

export function blackjackResponse(row: RoundRow, balance: number): BlackjackRoundResponse {
  return {
    round: roundSummary(row),
    state: blackjackPublicView(row.state as BlackjackState),
    balance,
  };
}

export function videoPokerResponse(row: RoundRow, balance: number): VideoPokerRoundResponse {
  return {
    round: roundSummary(row),
    state: videoPokerPublicView(row.state as VideoPokerState),
    balance,
  };
}

// ---------------------------------------------------------------------------
// History: one-line Italian summaries, detail, verification input
// ---------------------------------------------------------------------------

const COLOR_IT: Record<RouletteColor, string> = { red: 'rosso', black: 'nero', green: 'verde' };

const SLOT_KIND_IT: Record<SlotWinKind, string> = {
  THREE_SEVEN: 'Tris di 7',
  THREE_BAR: 'Tris di BAR',
  THREE_BELL: 'Tris di campane',
  THREE_CHERRY: 'Tris di ciliegie',
  THREE_LEMON: 'Tris di limoni',
  THREE_ORANGE: 'Tris di arance',
  TWO_CHERRY: 'Due ciliegie',
};

function blackjackSummary(state: BlackjackState): string {
  const result = state.result;
  if (state.phase !== 'settled' || result === null) return 'Mano in corso';
  if (result.dealerBlackjack) {
    return result.hands[0]?.outcome === 'push'
      ? 'Blackjack tuo e del banco: pareggio'
      : 'Blackjack del banco';
  }
  if (state.hands.length === 1 && result.hands[0]?.outcome === 'blackjack') return 'Blackjack!';
  const dealer = result.dealerBusted ? 'banco sballato' : `banco ${result.dealerTotal}`;
  const allBusted = result.hands.every((_, i) => handValue(state.hands[i]!.cards).total > 21);
  const parts = state.hands.map((hand, i) => {
    const total = handValue(hand.cards).total;
    const outcome = result.hands[i]?.outcome;
    if (total > 21) return `sballato (${total})`;
    if (outcome === 'win') return `vinta con ${total}`;
    if (outcome === 'push') return `pareggio a ${total}`;
    return `persa con ${total}`;
  });
  const text =
    parts.length === 1 ? parts[0]! : parts.map((p, i) => `mano ${i + 1} ${p}`).join(' · ');
  const line = allBusted ? text : `${text}, ${dealer}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export function roundSummaryText(row: RoundRow): string {
  switch (row.game) {
    case 'roulette': {
      const s = row.state as RouletteSettlement;
      return `Uscito ${s.number} ${COLOR_IT[s.color]}`;
    }
    case 'slot': {
      const s = row.state as SlotSettlement;
      return s.kind === null ? 'Nessuna combinazione' : SLOT_KIND_IT[s.kind];
    }
    case 'blackjack':
      return blackjackSummary(row.state as BlackjackState);
    case 'videopoker': {
      const s = row.state as VideoPokerState;
      if (s.phase !== 'settled' || s.result === null) return 'Mano in corso';
      return VIDEO_POKER_HAND_NAMES_IT[s.result.rank];
    }
  }
}

export function historyItem(row: RoundRow): HistoryItem {
  return {
    id: String(row.id),
    game: row.game,
    status: row.status,
    stake: row.stake,
    payout: row.payout,
    net: row.status === 'settled' ? row.payout - row.stake : 0,
    createdAt: iso(row.created_at),
    settledAt: isoOrNull(row.settled_at),
    nonce: row.nonce,
    summary: roundSummaryText(row),
  };
}

function detailData(row: RoundRow): RoundDetailData {
  switch (row.game) {
    case 'roulette':
      return {
        game: 'roulette',
        bets: (row.input as RouletteInput).bets,
        settlement: row.state as RouletteSettlement,
      };
    case 'slot':
      return {
        game: 'slot',
        bet: (row.input as SlotInput).bet,
        settlement: row.state as SlotSettlement,
      };
    case 'blackjack': {
      const input = row.input as BlackjackInput;
      return {
        game: 'blackjack',
        bet: input.bet,
        actions: input.actions,
        state: blackjackPublicView(row.state as BlackjackState),
      };
    }
    case 'videopoker': {
      const input = row.input as VideoPokerInput;
      return {
        game: 'videopoker',
        bet: input.bet,
        held: input.held,
        state: videoPokerPublicView(row.state as VideoPokerState),
      };
    }
  }
}

/** Inputs for verifyRound(); null while the round is open. */
export function verifyInputOf(row: RoundRow): VerifyInput | null {
  if (row.status !== 'settled') return null;
  switch (row.game) {
    case 'roulette':
      return { game: 'roulette', bets: (row.input as RouletteInput).bets };
    case 'slot':
      return { game: 'slot', bet: (row.input as SlotInput).bet };
    case 'blackjack': {
      const input = row.input as BlackjackInput;
      return { game: 'blackjack', bet: input.bet, actions: input.actions };
    }
    case 'videopoker': {
      const input = row.input as VideoPokerInput;
      return input.held === null ? null : { game: 'videopoker', bet: input.bet, held: input.held };
    }
  }
}

export function roundDetail(row: RoundRow): RoundDetailResponse {
  return { round: roundSummary(row), detail: detailData(row), verifyInput: verifyInputOf(row) };
}
