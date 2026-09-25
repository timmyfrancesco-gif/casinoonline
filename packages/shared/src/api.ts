/**
 * HTTP API contract between @casino/server and @casino/web.
 *
 * - Request bodies are validated on the server with the zod schemas below.
 * - Response bodies are described by the TypeScript interfaces below.
 * - All amounts are integers in units (100 units = 1 chip). Stakes must be whole chips.
 * - Timestamps are ISO 8601 strings (UTC). Database ids are serialised as strings.
 * - Every non-GET request must send the header `x-casino-csrf: 1` (see CSRF_HEADER).
 * - Errors: HTTP 4xx/5xx with body ApiErrorBody.
 *
 * Endpoints (all prefixed with /api):
 *   GET    /health                          -> HealthResponse
 *   POST   /auth/register     RegisterRequest   -> 201 MeResponse (sets session cookie)
 *   POST   /auth/login        LoginRequest      -> MeResponse (sets session cookie)
 *   POST   /auth/logout                          -> 204 (clears cookie)
 *   GET    /auth/me                              -> MeResponse | 401 UNAUTHENTICATED
 *   POST   /account/password  ChangePasswordRequest -> 204 (other sessions are revoked)
 *   DELETE /account           DeleteAccountRequest  -> 204 (all user data deleted)
 *   GET    /wallet                               -> WalletResponse
 *   POST   /wallet/reset                         -> WalletResponse
 *   GET    /fairness                             -> FairnessResponse
 *   POST   /fairness/rotate   RotateSeedRequest  -> FairnessResponse
 *   POST   /games/roulette/spin     RouletteSpinRequest -> RouletteSpinResponse
 *   POST   /games/slot/spin         StakeRequest        -> SlotSpinResponse
 *   POST   /games/blackjack/deal    StakeRequest        -> BlackjackRoundResponse
 *   POST   /games/blackjack/action  BlackjackActionRequest -> BlackjackRoundResponse
 *   GET    /games/blackjack/open                        -> OpenRoundResponse<BlackjackRoundResponse>
 *   POST   /games/videopoker/deal   StakeRequest        -> VideoPokerRoundResponse
 *   POST   /games/videopoker/draw   VideoPokerDrawRequest -> VideoPokerRoundResponse
 *   GET    /games/videopoker/open                       -> OpenRoundResponse<VideoPokerRoundResponse>
 *   GET    /history?game=&cursor=&limit=         -> HistoryPage
 *   GET    /history/export.csv                   -> text/csv (all rounds of the user)
 *   GET    /history/:id                          -> RoundDetailResponse
 *   GET    /stats                                -> StatsResponse
 *   GET    /rg                                   -> RgStatus
 *   PUT    /rg/loss-limit     SetLossLimitRequest   -> RgStatus
 *   POST   /rg/self-exclusion SelfExclusionRequest  -> RgStatus
 *   PUT    /rg/reality-check  RealityCheckRequest   -> RgStatus
 */
import { z } from 'zod';
import {
  BLACKJACK_ACTIONS,
  CLIENT_SEED_PATTERN,
  GAME_IDS,
  ROULETTE_EVEN_TYPES,
  ROULETTE_INDEXED_TYPES,
  ROULETTE_INSIDE_TYPES,
  SERVER_SEED_PATTERN,
  UNITS_PER_CHIP,
  type Amount,
  type BlackjackAction,
  type BlackjackPublicState,
  type GameId,
  type RouletteBet,
  type RouletteSettlement,
  type SlotSettlement,
  type VerifyInput,
  type VideoPokerPublicState,
} from '@casino/engine';
import {
  LOSS_LIMIT_PERIODS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REALITY_CHECK_OPTIONS,
  ROULETTE_MAX_BETS,
  SELF_EXCLUSION_DURATIONS,
  USERNAME_PATTERN,
  type LossLimitPeriod,
  type RealityCheckMinutes,
} from './constants.ts';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'VALIDATION_ERROR', // 400 body/query invalid (details = zod issues)
  'UNAUTHENTICATED', // 401 no/expired session
  'CSRF_REJECTED', // 403 missing CSRF header or foreign Origin
  'NOT_FOUND', // 404
  'CONFLICT', // 409 stale `step`, concurrent request, idempotency key reused with a different body
  'RATE_LIMITED', // 429
  'USERNAME_TAKEN', // 409
  'INVALID_CREDENTIALS', // 401 wrong username/password
  'UNDERAGE', // 400 birth date < 18 years ago
  'INSUFFICIENT_FUNDS', // 400 balance lower than the stake
  'BET_LIMIT', // 400 outside table limits / not whole chips / invalid bet layout
  'RG_SELF_EXCLUDED', // 403 self-exclusion active (details.until)
  'RG_LOSS_LIMIT', // 403 stake would exceed a loss limit (details.period, details.remaining)
  'ROUND_ALREADY_OPEN', // 409 an open round of this game exists (details.roundId)
  'ROUND_NOT_OPEN', // 409 round not found/open for this user
  'ILLEGAL_ACTION', // 400 action not allowed in the current state
  'SEED_ROTATION_BLOCKED', // 409 cannot rotate seeds while a round is open
  'RESET_NOT_ALLOWED', // 409 reset only when balance < starting balance and no open rounds
  'INTERNAL', // 500
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Human readable, in Italian. */
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A stake: positive whole number of chips, expressed in units. */
export const stakeSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .refine((v) => v % UNITS_PER_CHIP === 0, {
    message: 'La puntata deve essere un numero intero di fiches',
  });

export const idempotencyKeySchema = z.uuid();
export const gameIdSchema = z.enum(GAME_IDS);

// ---------------------------------------------------------------------------
// Auth & account
// ---------------------------------------------------------------------------

export const registerRequestSchema = z.object({
  username: z
    .string()
    .regex(USERNAME_PATTERN, 'Nome utente: 3-20 caratteri tra lettere, numeri e _'),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  /** YYYY-MM-DD. Used only to check the age; it is NOT stored. */
  birthDate: z.iso.date(),
  acceptTerms: z.literal(true),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface MeResponse {
  user: PublicUser;
  balance: Amount;
  /** When the current login session started (for the reality check). */
  sessionStartedAt: string;
}

export interface HealthResponse {
  ok: true;
  db: boolean;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export interface WalletResponse {
  balance: Amount;
}

// ---------------------------------------------------------------------------
// Provably fair
// ---------------------------------------------------------------------------

export const rotateSeedRequestSchema = z.object({
  /** New client seed; omitted = server generates a random one. */
  clientSeed: z
    .string()
    .regex(CLIENT_SEED_PATTERN, 'Seed client: 1-64 caratteri ASCII stampabili, senza spazi né ":"')
    .optional(),
  /**
   * FairnessResponse.next.serverSeedHash as shown to the player when choosing the client seed.
   * If it is no longer the pending next seed (a rotation happened meanwhile) the request fails
   * with 409 CONFLICT, so the new pair always uses the seed the player saw committed.
   */
  nextServerSeedHash: z
    .string()
    .regex(SERVER_SEED_PATTERN, 'Hash del prossimo seed server: 64 caratteri esadecimali')
    .optional(),
});
export type RotateSeedRequest = z.infer<typeof rotateSeedRequestSchema>;

export interface ActiveSeedPair {
  id: string;
  serverSeedHash: string;
  clientSeed: string;
  /** Nonce the NEXT round will use. */
  nextNonce: number;
  createdAt: string;
}

export interface RevealedSeedPair {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  /** Number of rounds played with this pair (nonces 0..roundsPlayed-1). */
  roundsPlayed: number;
  createdAt: string;
  revealedAt: string;
}

/**
 * The server seed of the NEXT pair, generated in advance: only its hash is shown. Rotation turns
 * it into the active server seed (active.serverSeedHash then equals this hash), so the server
 * commits to it before the player chooses the new client seed.
 */
export interface NextServerSeed {
  serverSeedHash: string;
}

export interface FairnessResponse {
  active: ActiveSeedPair;
  next: NextServerSeed;
  /** Most recent revealed pairs first (max 20). */
  revealed: RevealedSeedPair[];
}

/** Provably-fair reference attached to every round. */
export interface FairnessRef {
  seedPairId: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /** Revealed server seed, or null while the pair is still active. */
  serverSeed: string | null;
}

// ---------------------------------------------------------------------------
// Rounds (common)
// ---------------------------------------------------------------------------

export type RoundStatus = 'open' | 'settled';

export interface RoundSummary {
  id: string;
  game: GameId;
  status: RoundStatus;
  /** Total staked in the round (including doubles/splits). */
  stake: Amount;
  /** Total returned (stake included); 0 while open. */
  payout: Amount;
  createdAt: string;
  settledAt: string | null;
  fairness: FairnessRef;
}

export const stakeRequestSchema = z.object({
  amount: stakeSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type StakeRequest = z.infer<typeof stakeRequestSchema>;

// ---------------------------------------------------------------------------
// Roulette
// ---------------------------------------------------------------------------

export const rouletteBetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(ROULETTE_INSIDE_TYPES),
    numbers: z.array(z.number().int().min(0).max(36)).min(1).max(6),
    amount: stakeSchema,
  }),
  z.object({
    type: z.enum(ROULETTE_INDEXED_TYPES),
    index: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    amount: stakeSchema,
  }),
  z.object({
    type: z.enum(ROULETTE_EVEN_TYPES),
    amount: stakeSchema,
  }),
]);

export const rouletteSpinRequestSchema = z.object({
  bets: z.array(rouletteBetSchema).min(1).max(ROULETTE_MAX_BETS),
  idempotencyKey: idempotencyKeySchema,
});
export type RouletteSpinRequest = { bets: RouletteBet[]; idempotencyKey: string };

export interface RouletteSpinResponse {
  round: RoundSummary;
  settlement: RouletteSettlement;
  balance: Amount;
}

// ---------------------------------------------------------------------------
// Slot
// ---------------------------------------------------------------------------

export interface SlotSpinResponse {
  round: RoundSummary;
  settlement: SlotSettlement;
  balance: Amount;
}

// ---------------------------------------------------------------------------
// Blackjack
// ---------------------------------------------------------------------------

export const blackjackActionRequestSchema = z.object({
  roundId: z.string().regex(/^\d+$/),
  action: z.enum(BLACKJACK_ACTIONS),
  /** Must equal state.step as last seen by the client; otherwise 409 CONFLICT (prevents double-clicks). */
  step: z.number().int().min(0),
});
export type BlackjackActionRequest = { roundId: string; action: BlackjackAction; step: number };

export interface BlackjackRoundResponse {
  round: RoundSummary;
  state: BlackjackPublicState;
  balance: Amount;
}

// ---------------------------------------------------------------------------
// Video poker
// ---------------------------------------------------------------------------

export const videoPokerDrawRequestSchema = z.object({
  roundId: z.string().regex(/^\d+$/),
  held: z.array(z.boolean()).length(5),
  step: z.number().int().min(0),
});
export type VideoPokerDrawRequest = z.infer<typeof videoPokerDrawRequestSchema>;

export interface VideoPokerRoundResponse {
  round: RoundSummary;
  state: VideoPokerPublicState;
  balance: Amount;
}

export interface OpenRoundResponse<T> {
  round: T | null;
}

// ---------------------------------------------------------------------------
// History & stats
// ---------------------------------------------------------------------------

export const historyQuerySchema = z.object({
  game: gameIdSchema.optional(),
  /** Opaque cursor from a previous page (round id). */
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface HistoryItem {
  id: string;
  game: GameId;
  status: RoundStatus;
  stake: Amount;
  payout: Amount;
  /** payout - stake (0 while open). */
  net: Amount;
  createdAt: string;
  settledAt: string | null;
  nonce: number;
  /** Short Italian description, e.g. "Uscito 17 nero", "Blackjack!", "Full". */
  summary: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}

export type RoundDetailData =
  | { game: 'roulette'; bets: RouletteBet[]; settlement: RouletteSettlement }
  | { game: 'slot'; bet: Amount; settlement: SlotSettlement }
  | { game: 'blackjack'; bet: Amount; actions: BlackjackAction[]; state: BlackjackPublicState }
  | { game: 'videopoker'; bet: Amount; held: boolean[] | null; state: VideoPokerPublicState };

export interface RoundDetailResponse {
  round: RoundSummary;
  detail: RoundDetailData;
  /** Inputs to re-compute the round with verifyRound() once the server seed is revealed (null while open). */
  verifyInput: VerifyInput | null;
}

export interface GameStats {
  rounds: number;
  wagered: Amount;
  returned: Amount;
  /** returned - wagered. */
  net: Amount;
}

export interface StatsResponse {
  lifetime: GameStats;
  byGame: Record<GameId, GameStats>;
  /** Current login session. */
  session: GameStats & { startedAt: string };
  /** How many times the balance was reset. Resets never erase statistics or loss-limit usage. */
  resets: number;
}

// ---------------------------------------------------------------------------
// Responsible gaming
// ---------------------------------------------------------------------------

export const setLossLimitRequestSchema = z.object({
  period: z.enum(LOSS_LIMIT_PERIODS),
  /** null = remove the limit (takes effect after the cooling-off period). */
  value: stakeSchema.nullable(),
});
export type SetLossLimitRequest = z.infer<typeof setLossLimitRequestSchema>;

export const selfExclusionRequestSchema = z.object({
  duration: z.enum(SELF_EXCLUSION_DURATIONS),
});
export type SelfExclusionRequest = z.infer<typeof selfExclusionRequestSchema>;

export const realityCheckRequestSchema = z.object({
  minutes: z.union(
    REALITY_CHECK_OPTIONS.map((m) => z.literal(m)) as [
      z.ZodLiteral<15>,
      z.ZodLiteral<30>,
      z.ZodLiteral<60>,
    ],
  ),
});
export type RealityCheckRequest = { minutes: RealityCheckMinutes };

export interface LossLimitState {
  /** Limit currently in force (null = none). */
  value: Amount | null;
  /** A raise/removal waiting for the cooling-off period. */
  pending: { value: Amount | null; effectiveAt: string } | null;
  /** Net loss in the rolling window (never negative). */
  used: Amount;
  /** value - used, or null when there is no limit. */
  remaining: Amount | null;
}

export interface RgStatus {
  lossLimits: Record<LossLimitPeriod, LossLimitState>;
  selfExclusion: { until: string | null };
  realityCheckMinutes: RealityCheckMinutes;
  session: { startedAt: string; elapsedMs: number; rounds: number; net: Amount };
}
