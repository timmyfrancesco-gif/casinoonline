import type { Config } from './config.ts';
import type { Pool } from './db/pool.ts';

export interface RateLimits {
  /** Requests per minute per IP on every route. */
  global: number;
  /** Requests per minute per IP on login/registration and password-checking routes. */
  auth: number;
}

/** Dependencies shared by every route module. */
export interface AppContext {
  pool: Pool;
  config: Config;
  /** Clock used for every stored timestamp and time comparison (injectable in tests). */
  now: () => Date;
  rateLimits: RateLimits;
}
