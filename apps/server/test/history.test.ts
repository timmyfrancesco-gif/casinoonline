import { STARTING_BALANCE } from '@casino/engine';
import type {
  HistoryPage,
  RoundDetailResponse,
  SlotSpinResponse,
  StatsResponse,
} from '@casino/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { csvField } from '../src/routes/history.ts';
import {
  CHIP,
  createTestEnv,
  expectError,
  key,
  loginPlayer,
  registerPlayer,
  truncateAll,
  type TestEnv,
} from './helpers.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await truncateAll(env.pool);
  env.clock.offsetMs = 0;
});

/** Minimal RFC 4180 parser for the assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  return rows;
}

describe('history', () => {
  it('paginates by id desc with a cursor and filters by game', async () => {
    const p = await registerPlayer(env.app);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await p.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
      ids.push(r.json<SlotSpinResponse>().round.id);
      const rr = await p.post('/api/games/roulette/spin', {
        bets: [{ type: 'even', amount: CHIP }],
        idempotencyKey: key(),
      });
      ids.push(rr.json().round.id);
    }
    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/history?limit=4${cursor ? `&cursor=${cursor}` : ''}`;
      const page: HistoryPage = (await p.get(url)).json<HistoryPage>();
      expect(page.items.length).toBeLessThanOrEqual(4);
      all.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(all).toEqual([...ids].reverse());

    const slots = (await p.get('/api/history?game=slot&limit=100')).json<HistoryPage>();
    expect(slots.items).toHaveLength(5);
    expect(slots.items.every((i) => i.game === 'slot')).toBe(true);
    expect(slots.nextCursor).toBeNull();
    const exact = (await p.get('/api/history?limit=10')).json<HistoryPage>();
    expect(exact.items).toHaveLength(10);
    expect(exact.nextCursor).toBeNull();

    const item = slots.items[0]!;
    expect(item.net).toBe(item.payout - item.stake);
    expect(item.status).toBe('settled');
    expect(typeof item.summary).toBe('string');
    const roulette = (await p.get('/api/history?game=roulette&limit=1')).json<HistoryPage>();
    expect(roulette.items[0]!.summary).toMatch(/^Uscito \d{1,2} (rosso|nero|verde)$/);
  });

  it('never shows other users’ rounds', async () => {
    const a = await registerPlayer(env.app);
    const b = await registerPlayer(env.app);
    const spin = await a.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect((await b.get('/api/history')).json<HistoryPage>().items).toEqual([]);
    expectError(await b.get(`/api/history/${spin.json().round.id}`), 404, 'NOT_FOUND');
    expectError(await a.get('/api/history/abc'), 404, 'NOT_FOUND');
    expectError(await a.get('/api/history/99999999999999999999'), 404, 'NOT_FOUND');
  });

  it('returns the round detail with the verify input', async () => {
    const p = await registerPlayer(env.app);
    const bets = [{ type: 'column', index: 1, amount: 2 * CHIP }];
    const spin = await p.post('/api/games/roulette/spin', { bets, idempotencyKey: key() });
    const detail = (
      await p.get(`/api/history/${spin.json().round.id}`)
    ).json<RoundDetailResponse>();
    expect(detail.round).toEqual(spin.json().round);
    expect(detail.detail).toEqual({ game: 'roulette', bets, settlement: spin.json().settlement });
    expect(detail.verifyInput).toEqual({ game: 'roulette', bets });
  });

  it('exports every round as CSV', async () => {
    const p = await registerPlayer(env.app);
    for (let i = 0; i < 3; i++) {
      await p.post('/api/games/slot/spin', { amount: 2 * CHIP, idempotencyKey: key() });
    }
    await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey: key() });
    const res = await p.get('/api/history/export.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="storico-fiches-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    const rows = parseCsv(res.body.slice(1));
    expect(rows[0]).toEqual([
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
    ]);
    expect(rows).toHaveLength(5);
    const [open, ...settled] = rows.slice(1);
    expect(open![1]).toBe('Video Poker Jacks or Better');
    expect(open![2]).toBe('in corso');
    expect(open![5]).toBe('0.00');
    expect(open![8]).toBe('Mano in corso');
    expect(open![13]).toBe('');
    for (const r of settled) {
      expect(r[1]).toBe('Slot Frutta');
      expect(r[3]).toBe('2.00');
      expect(Number(r[5])).toBe(Number(r[4]) - 2);
    }
  });

  it('escapes CSV fields', () => {
    expect(csvField('semplice')).toBe('semplice');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('di "lusso"')).toBe('"di ""lusso"""');
    expect(csvField('riga\nnuova')).toBe('"riga\nnuova"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('-1+2')).toBe("'-1+2");
    expect(csvField(-5)).toBe('-5');
    expect(csvField('-10.50')).toBe('-10.50');
    expect(csvField(null)).toBe('');
  });
});

describe('stats', () => {
  it('reports lifetime, per game and session totals of settled rounds', async () => {
    const p = await registerPlayer(env.app, 'Statistico');
    for (let i = 0; i < 3; i++) {
      await p.post('/api/games/slot/spin', { amount: 2 * CHIP, idempotencyKey: key() });
    }
    await p.post('/api/games/roulette/spin', {
      bets: [{ type: 'high', amount: 4 * CHIP }],
      idempotencyKey: key(),
    });
    // Open rounds are not counted.
    await p.post('/api/games/videopoker/deal', { amount: CHIP, idempotencyKey: key() });

    const { rows } = await env.pool.query<{ game: string; stake: number; payout: number }>(
      `SELECT game, stake, payout FROM rounds WHERE user_id = $1 AND status = 'settled'`,
      [p.userId],
    );
    const wagered = rows.reduce((s, r) => s + r.stake, 0);
    const returned = rows.reduce((s, r) => s + r.payout, 0);
    const stats = (await p.get('/api/stats')).json<StatsResponse>();
    expect(stats.lifetime).toEqual({ rounds: 4, wagered, returned, net: returned - wagered });
    expect(stats.byGame.slot.rounds).toBe(3);
    expect(stats.byGame.slot.wagered).toBe(6 * CHIP);
    expect(stats.byGame.roulette.wagered).toBe(4 * CHIP);
    expect(stats.byGame.blackjack).toEqual({ rounds: 0, wagered: 0, returned: 0, net: 0 });
    expect(stats.byGame.videopoker.rounds).toBe(0);
    expect(stats.session).toMatchObject({ rounds: 4, wagered, returned });
    expect(stats.resets).toBe(0);
    const wallet = (await p.get('/api/wallet')).json<{ balance: number }>().balance;
    expect(wallet).toBe(STARTING_BALANCE + stats.lifetime.net - CHIP);

    // A new login starts a new session: its totals restart from zero.
    env.clock.advance(60_000);
    const again = await loginPlayer(env.app, 'Statistico');
    const fresh = (await again.get('/api/stats')).json<StatsResponse>();
    expect(fresh.lifetime).toEqual(stats.lifetime);
    expect(fresh.session).toMatchObject({ rounds: 0, wagered: 0, returned: 0, net: 0 });
    expect(Date.parse(fresh.session.startedAt)).toBeGreaterThan(
      Date.parse(stats.session.startedAt),
    );
    await again.post('/api/games/slot/spin', { amount: CHIP, idempotencyKey: key() });
    expect((await again.get('/api/stats')).json<StatsResponse>().session.rounds).toBe(1);
  });
});
