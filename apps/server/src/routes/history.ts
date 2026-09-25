import { GAME_NAMES_IT } from '@casino/engine';
import { gameIdSchema, historyQuerySchema, type HistoryPage } from '@casino/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authOf } from '../auth/hooks.ts';
import type { AppContext } from '../context.ts';
import { apiError, parseWith } from '../lib/errors.ts';
import { parseId } from '../lib/util.ts';
import {
  getRound,
  historyItem,
  ROUND_SELECT,
  roundDetail,
  type RoundRow,
} from '../games/rounds.ts';

const exportQuerySchema = z.object({ game: gameIdSchema.optional() });
const EXPORT_BATCH = 500;

const STATUS_IT = { open: 'in corso', settled: 'conclusa' } as const;

/** Units -> chips with a dot decimal separator (e.g. -1050 -> "-10.50"), spreadsheet friendly. */
function chipsDecimal(units: number): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * RFC 4180 field. Text starting with a formula trigger is prefixed with ' (CSV injection),
 * except plain decimal numbers such as "-10.50".
 */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'id',
  'gioco',
  'stato',
  'puntata_fiches',
  'restituito_fiches',
  'netto_fiches',
  'creato_il',
  'concluso_il',
  'esito',
  'seed_pair_id',
  'hash_server_seed',
  'client_seed',
  'nonce',
  'server_seed',
];

function csvRow(row: RoundRow): string {
  const item = historyItem(row);
  return [
    item.id,
    GAME_NAMES_IT[row.game],
    STATUS_IT[row.status],
    chipsDecimal(item.stake),
    chipsDecimal(item.payout),
    chipsDecimal(item.net),
    item.createdAt,
    item.settledAt,
    item.summary,
    String(row.seed_pair_id),
    row.server_seed_hash,
    row.client_seed,
    row.nonce,
    row.revealed_at === null ? null : row.server_seed,
  ]
    .map(csvField)
    .join(',');
}

export function historyRoutes(ctx: AppContext) {
  const { pool } = ctx;

  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/history', async (request): Promise<HistoryPage> => {
      const { userId } = authOf(request);
      const query = parseWith(historyQuerySchema, request.query);
      const cursor = query.cursor === undefined ? null : parseId(query.cursor);
      if (query.cursor !== undefined && cursor === null) {
        throw apiError('VALIDATION_ERROR', 'Cursore non valido.');
      }
      const { rows } = await pool.query<RoundRow>(
        `${ROUND_SELECT}
          WHERE r.user_id = $1 AND ($2::text IS NULL OR r.game = $2)
            AND ($3::bigint IS NULL OR r.id < $3)
          ORDER BY r.id DESC
          LIMIT $4`,
        [userId, query.game ?? null, cursor, query.limit + 1],
      );
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(historyItem),
        nextCursor: rows.length > query.limit ? String(page[page.length - 1]!.id) : null,
      };
    });

    app.get('/history/export.csv', async (request, reply) => {
      const { userId } = authOf(request);
      const query = parseWith(exportQuerySchema, request.query);
      const lines = [CSV_HEADER.join(',')];
      let before: number | null = null;
      for (;;) {
        const { rows }: { rows: RoundRow[] } = await pool.query<RoundRow>(
          `${ROUND_SELECT}
            WHERE r.user_id = $1 AND ($2::text IS NULL OR r.game = $2)
              AND ($3::bigint IS NULL OR r.id < $3)
            ORDER BY r.id DESC
            LIMIT $4`,
          [userId, query.game ?? null, before, EXPORT_BATCH],
        );
        for (const row of rows) lines.push(csvRow(row));
        if (rows.length < EXPORT_BATCH) break;
        before = rows[rows.length - 1]!.id;
      }
      const date = ctx.now().toISOString().slice(0, 10);
      // BOM so that spreadsheet apps detect UTF-8; CRLF line endings per RFC 4180.
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="storico-fiches-${date}.csv"`)
        .header('cache-control', 'no-store')
        .send(`\uFEFF${lines.join('\r\n')}\r\n`);
    });

    app.get('/history/:id', async (request) => {
      const { userId } = authOf(request);
      const { id } = request.params as { id: string };
      const roundId = parseId(id);
      const row = roundId === null ? null : await getRound(pool, userId, roundId);
      if (!row) throw apiError('NOT_FOUND', 'Round non trovato.');
      return roundDetail(row);
    });
  };
}
