import { z } from 'zod';
import type { RateLimits } from './context.ts';

export type TrustProxy = boolean | number | string;

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Allowed values of the Origin header on state-changing requests. */
  appOrigins: string[];
  nodeEnv: 'development' | 'production' | 'test';
  cookieSecure: boolean;
  /** Directory of the web build to serve (SPA), or null. */
  serveWebDist: string | null;
  trustProxy: TrustProxy;
  logLevel: string;
  /** Overrides of the per-IP rate limits (requests per minute); unset = defaults. */
  rateLimits: Partial<RateLimits>;
}

const emptyToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const booleanString = z.preprocess(
  emptyToUndefined,
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .transform((v) => v === 'true' || v === '1' || v === 'yes')
    .optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL è obbligatoria'),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(65535).default(3000)),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  APP_ORIGIN: z.preprocess(emptyToUndefined, z.string().default('http://localhost:5173')),
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'production', 'test']).default('development'),
  ),
  COOKIE_SECURE: booleanString,
  SERVE_WEB_DIST: z.preprocess(emptyToUndefined, z.string().optional()),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().optional()),
  RATE_LIMIT_GLOBAL: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  RATE_LIMIT_AUTH: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      let url: URL;
      try {
        url = new URL(s);
      } catch {
        throw new Error(`APP_ORIGIN non valida: ${s}`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`APP_ORIGIN deve essere http(s): ${s}`);
      }
      return url.origin;
    });
  if (origins.length === 0) throw new Error('APP_ORIGIN vuota');
  return origins;
}

/**
 * "true"/"false", a hop count (e.g. 1 = one reverse proxy in front: safer than "true", which
 * trusts every X-Forwarded-For entry), or a comma-separated list of trusted addresses/CIDRs.
 */
function parseTrustProxy(raw: string | undefined): TrustProxy {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return raw.trim();
}

/** Reads and validates the configuration from environment variables (SPEC §6). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configurazione non valida:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    appOrigins: parseOrigins(e.APP_ORIGIN),
    nodeEnv: e.NODE_ENV,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    serveWebDist: e.SERVE_WEB_DIST ?? null,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    rateLimits: {
      ...(e.RATE_LIMIT_GLOBAL === undefined ? {} : { global: e.RATE_LIMIT_GLOBAL }),
      ...(e.RATE_LIMIT_AUTH === undefined ? {} : { auth: e.RATE_LIMIT_AUTH }),
    },
  };
}
