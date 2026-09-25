import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '@casino/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { csrfHook, requireAuth } from './auth/hooks.ts';
import type { Config } from './config.ts';
import type { AppContext, RateLimits } from './context.ts';
import type { Pool } from './db/pool.ts';
import { apiError, errorHandler } from './lib/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { gameRoutes } from './routes/games.ts';
import { historyRoutes } from './routes/history.ts';
import { playerRoutes } from './routes/player.ts';

export const BODY_LIMIT = 64 * 1024;
/**
 * Time allowed to receive a whole request (Fastify's default 0 disables it, and the server may be
 * exposed without a reverse proxy): a client trickling a body cannot hold the socket forever.
 * It does not cover sending the response (e.g. a long CSV export).
 */
export const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_RATE_LIMITS: RateLimits = { global: 300, auth: 10 };

export interface BuildAppOptions {
  config: Config;
  pool: Pool;
  /** Injectable clock (tests move time forward). */
  now?: () => Date;
  rateLimits?: Partial<RateLimits>;
}

function prettyTransportTarget(): string | null {
  try {
    return fileURLToPath(import.meta.resolve('pino-pretty'));
  } catch {
    return null;
  }
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.logLevel === 'silent') return false;
  const base = {
    level: config.logLevel,
    // Never log credentials or session tokens.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
      ],
      censor: '[redatto]',
    },
  };
  const pretty = config.nodeEnv === 'development' ? prettyTransportTarget() : null;
  return pretty
    ? {
        ...base,
        transport: {
          target: pretty,
          options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : base;
}

function trustHops(hops: number) {
  return (_address: string, hop: number): boolean => hop < hops;
}

/** Builds the Fastify instance (routes under /api, optional SPA) without listening. */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, pool } = options;
  const ctx: AppContext = {
    pool,
    config,
    now: options.now ?? (() => new Date()),
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...config.rateLimits, ...options.rateLimits },
  };

  const app = Fastify({
    logger: loggerOptions(config),
    // A hop count is expressed as a function (the typings do not accept numbers).
    trustProxy:
      typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
    bodyLimit: BODY_LIMIT,
    requestTimeout: REQUEST_TIMEOUT_MS,
    return503OnClosing: true,
  });

  app.decorateRequest('auth', null);
  app.setErrorHandler(errorHandler);

  // Empty JSON bodies (e.g. POST /auth/logout from fetch with a JSON content type) are allowed.
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body === 'string' && body.trim() === '') {
      done(null, undefined);
      return;
    }
    defaultJsonParser(request, body as string, done);
  });

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // HSTS only makes sense when the deployment is HTTPS.
    strictTransportSecurity: config.cookieSecure ? undefined : false,
  });
  await app.register(fastifyRateLimit, {
    global: true,
    max: ctx.rateLimits.global,
    timeWindow: 60_000,
    errorResponseBuilder: (_request, context) =>
      apiError(
        'RATE_LIMITED',
        `Troppe richieste: riprova tra ${Math.max(1, Math.ceil(context.ttl / 1000))} secondi.`,
        { retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)) },
      ),
  });

  app.addHook('onRequest', csrfHook(ctx));

  await app.register(
    async (api) => {
      // API responses carry per-user data: no browser, proxy or CDN may store them.
      api.addHook('onSend', async (_request, reply, payload) => {
        if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
        return payload;
      });
      api.get('/health', async (): Promise<HealthResponse> => {
        let db = false;
        try {
          await pool.query('SELECT 1');
          db = true;
        } catch (err) {
          api.log.warn({ err }, 'database non raggiungibile');
        }
        return { ok: true, db };
      });
      await api.register(authRoutes(ctx));
      await api.register(async (secured) => {
        secured.addHook('preHandler', requireAuth(ctx));
        await secured.register(playerRoutes(ctx));
        await secured.register(gameRoutes(ctx));
        await secured.register(historyRoutes(ctx));
      });
    },
    { prefix: '/api' },
  );

  const webRoot = config.serveWebDist === null ? null : resolve(config.serveWebDist);
  if (webRoot !== null) {
    if (!existsSync(resolve(webRoot, 'index.html'))) {
      throw new Error(`SERVE_WEB_DIST non contiene index.html: ${webRoot}`);
    }
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      cacheControl: false,
      setHeaders: (reply, path) => {
        // Vite emits content-hashed files under assets/: cache them forever.
        reply.header(
          'cache-control',
          path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler({ preHandler: app.rateLimit() }, async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const isApi = path === '/api' || path.startsWith('/api/');
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (
      webRoot !== null &&
      !isApi &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !lastSegment.includes('.')
    ) {
      // SPA fallback: client-side routes are served index.html.
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    throw apiError('NOT_FOUND');
  });

  return app;
}
