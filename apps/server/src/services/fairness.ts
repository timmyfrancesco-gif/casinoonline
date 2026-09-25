import { randomBytes } from 'node:crypto';
import { hashServerSeed } from '@casino/engine';
import type { FairnessResponse, RevealedSeedPair } from '@casino/shared';
import type { PoolClient, Queryable } from '../db/pool.ts';
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

export async function createSeedPair(
  db: Queryable,
  userId: number,
  clientSeed: string | undefined,
  now: Date,
): Promise<SeedPairRow> {
  const serverSeed = randomBytes(32).toString('hex');
  const { rows } = await db.query<SeedPairRow>(
    `INSERT INTO seed_pairs (user_id, server_seed, server_seed_hash, client_seed, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      userId,
      serverSeed,
      hashServerSeed(serverSeed),
      clientSeed ?? randomBytes(16).toString('hex'),
      now,
    ],
  );
  return rows[0]!;
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
  const active = await db.query<SeedPairRow>(
    'SELECT * FROM seed_pairs WHERE user_id = $1 AND active',
    [userId],
  );
  const revealed = await db.query<SeedPairRow>(
    `SELECT * FROM seed_pairs WHERE user_id = $1 AND NOT active
      ORDER BY revealed_at DESC, id DESC LIMIT $2`,
    [userId, REVEALED_SHOWN],
  );
  const pair = active.rows[0];
  if (!pair) throw new Error(`Nessuna coppia di seed attiva per l'utente ${userId}`);
  return {
    active: {
      id: String(pair.id),
      serverSeedHash: pair.server_seed_hash,
      clientSeed: pair.client_seed,
      nextNonce: pair.next_nonce,
      createdAt: iso(pair.created_at),
    },
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

/** Reveals the active pair and activates a new one. Caller holds the user lock and checked open rounds. */
export async function rotateSeedPair(
  client: PoolClient,
  userId: number,
  clientSeed: string | undefined,
  now: Date,
): Promise<void> {
  await client.query(
    'UPDATE seed_pairs SET active = false, revealed_at = $2 WHERE user_id = $1 AND active',
    [userId, now],
  );
  await createSeedPair(client, userId, clientSeed, now);
}
