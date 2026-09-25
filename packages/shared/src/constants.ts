import { UNITS_PER_CHIP, type Amount, type GameId } from '@casino/engine';

/** Table limits in units (100 units = 1 chip). All stakes must be whole chips. */
export interface TableLimits {
  /** Minimum stake of a single bet / round. */
  min: Amount;
  /** Maximum stake of a single bet. */
  maxPerBet: Amount;
  /** Maximum total stake of one round (roulette: sum of bets; blackjack: base bet + double/split). */
  maxPerRound: Amount;
}

const chips = (n: number): Amount => n * UNITS_PER_CHIP;

export const TABLE_LIMITS: Record<GameId, TableLimits> = {
  roulette: { min: chips(1), maxPerBet: chips(100), maxPerRound: chips(500) },
  slot: { min: chips(1), maxPerBet: chips(50), maxPerRound: chips(50) },
  // Base bet up to 100; a split + two doubles can bring the total at risk to 4x.
  blackjack: { min: chips(1), maxPerBet: chips(100), maxPerRound: chips(400) },
  videopoker: { min: chips(1), maxPerBet: chips(50), maxPerRound: chips(50) },
};

/** Maximum number of individual bets in one roulette spin. */
export const ROULETTE_MAX_BETS = 40;

export const LOSS_LIMIT_PERIODS = ['24h', '7d', '30d'] as const;
export type LossLimitPeriod = (typeof LOSS_LIMIT_PERIODS)[number];

export const LOSS_LIMIT_PERIOD_MS: Record<LossLimitPeriod, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Raising or removing a limit only takes effect after this cooling-off period. Lowering is immediate. */
export const LIMIT_INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

export const SELF_EXCLUSION_DURATIONS = ['24h', '7d', '30d'] as const;
export type SelfExclusionDuration = (typeof SELF_EXCLUSION_DURATIONS)[number];
export const SELF_EXCLUSION_MS: Record<SelfExclusionDuration, number> = LOSS_LIMIT_PERIOD_MS;

export const REALITY_CHECK_OPTIONS = [15, 30, 60] as const;
export type RealityCheckMinutes = (typeof REALITY_CHECK_OPTIONS)[number];
export const DEFAULT_REALITY_CHECK_MINUTES: RealityCheckMinutes = 30;

export const MIN_AGE = 18;

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Session cookie lifetime (absolute) and idle timeout. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'casino_sid';
/** Every state-changing request must carry this header (CSRF defence together with SameSite cookies). */
export const CSRF_HEADER = 'x-casino-csrf';
export const CSRF_HEADER_VALUE = '1';

/** Italian national gambling helpline (Telefono Verde Nazionale per le problematiche legate al Gioco d'Azzardo, ISS). */
export const HELPLINE = {
  name: "Telefono Verde Nazionale Gioco d'Azzardo (ISS)",
  phone: '800 558 822',
};

export const VIRTUAL_CHIPS_DISCLAIMER =
  'Le fiches sono virtuali e non hanno alcun valore economico: non si acquistano, non si vincono premi e non si convertono in denaro.';
