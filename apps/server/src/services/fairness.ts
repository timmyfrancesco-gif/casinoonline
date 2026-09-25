import { randomBytes } from 'node:crypto';
import { hashServerSeed } from '@casino/engine';
import type { FairnessResponse, RevealedSeedPair } from '@casino/shared';
import type { PoolClient, Queryable } from '../db/pool.ts';
import { apiError } from '../lib/errors.ts';
import { iso } from '../lib/util.ts';

const REVEALED_SHOWN = 20;

export interface SeedPairRow {
  id: number;
  user_id: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  next_nonce: number;
  active: boolean;
  created_at: Date;
  revealed_at: Date | null;
}

function newServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, serverSeedHash: hashServerSeed(serverSeed) };
}

async function insertSeedPair(
  db: Queryable,
  userId: number,
  serverSeed: string,
  clientSeed: string | undefined,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO seed_pairs (user_id, server_seed, server_seed_hash, client_seed, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      serverSeed,
      hashServerSeed(serverSeed),
      clientSeed ?? randomBytes(16).toString('hex'),
      now,
    ],
  );
}

/** Registration: the first active pair (random seeds) and the pre-committed next server seed. */
export async function createSeedPairs(db: Queryable, userId: number, now: Date): Promise<void> {
  await insertSeedPair(db, userId, newServerSeed().serverSeed, undefined, now);
  const next = newServerSeed();
  await db.query(
    `INSERT INTO next_server_seeds (user_id, server_seed, server_seed_hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, next.serverSeed, next.serverSeedHash, now],
  );
}

/** Locks the active pair and reserves its next nonce. Caller must hold the user lock. */
export async function takeNonce(
  client: PoolClient,
  userId: number,
): Promise<{ pair: SeedPairRow; nonce: number }> {
  const { rows } = await client.query<SeedPairRow>(
    'SELECT * FROM seed_pairs WHERE user_id = $1 AND active FOR UPDATE',
    [userId],
  );
  const pair = rows[0];
  if (!pair) throw new Error(`Nessuna coppia di seed attiva per l'utente ${userId}`);
  await client.query('UPDATE seed_pairs SET next_nonce = next_nonce + 1 WHERE id = $1', [pair.id]);
  return { pair, nonce: pair.next_nonce };
}

export async function getFairness(db: Queryable, userId: number): Promise<FairnessResponse> {
  // One statement: the active pair and the next seed come from the same snapshot.
  const active = await db.query<SeedPairRow & { next_server_seed_hash: string | null }>(
    `SELECT sp.*, n.server_seed_hash AS next_server_seed_hash
       FROM seed_pairs sp LEFT JOIN next_server_seeds n ON n.user_id = sp.user_id
      WHERE sp.user_id = $1 AND sp.active`,
    [userId],
  );
  const revealed = await db.query<SeedPairRow>(
    `SELECT * FROM seed_pairs WHERE user_id = $1 AND NOT active
      ORDER BY revealed_at DESC, id DESC LIMIT $2`,
    [userId, REVEALED_SHOWN],
  );
  const pair = active.rows[0];
  // Every user has an active pair from registration on: none means the account was just deleted.
  if (!pair) throw apiError('UNAUTHENTICATED');
  if (pair.next_server_seed_hash === null) {
    throw new Error(`Nessun prossimo seed server per l'utente ${userId}`);
  }
  return {
    active: {
      id: String(pair.id),
      serverSeedHash: pair.server_seed_hash,
      clientSeed: pair.client_seed,
      nextNonce: pair.next_nonce,
      createdAt: iso(pair.created_at),
    },
    next: { serverSeedHash: pair.next_server_seed_hash },
    revealed: revealed.rows.map((p): RevealedSeedPair => ({
      id: String(p.id),
      serverSeed: p.server_seed,
      serverSeedHash: p.server_seed_hash,
      clientSeed: p.client_seed,
      roundsPlayed: p.next_nonce,
      createdAt: iso(p.created_at),
      revealedAt: iso(p.revealed_at!),
    })),
  };
}

/**
 * Reveals the active pair and activates a new one whose server seed is the pre-committed next
 * seed (its hash was shown before the client seed was chosen); then commits to a fresh next seed.
 * With `expectedNextHash`, fails with CONFLICT unless that is the seed being promoted.
 * Caller holds the user lock and checked open rounds.
 */
export async function rotateSeedPair(
  client: PoolClient,
  userId: number,
  clientSeed: string | undefined,
  expectedNextHash: string | undefined,
  now: Date,
): Promise<void> {
  const { rows } = await client.query<{ server_seed: string; server_seed_hash: string }>(
    'SELECT server_seed, server_seed_hash FROM next_server_seeds WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  const next = rows[0];
  if (!next) throw new Error(`Nessun prossimo seed server per l'utente ${userId}`);
  if (expectedNextHash !== undefined && expectedNextHash !== next.server_seed_hash) {
    throw apiError(
      'CONFLICT',
      'Il prossimo seed server è cambiato (i seed sono stati ruotati altrove): ricarica e riprova.',
    );
  }
  await client.query(
    'UPDATE seed_pairs SET active = false, revealed_at = $2 WHERE user_id = $1 AND active',
    [userId, now],
  );
  await insertSeedPair(client, userId, next.server_seed, clientSeed, now);
  const fresh = newServerSeed();
  await client.query(
    `UPDATE next_server_seeds SET server_seed = $2, server_seed_hash = $3, created_at = $4
      WHERE user_id = $1`,
    [userId, fresh.serverSeed, fresh.serverSeedHash, now],
  );
}
