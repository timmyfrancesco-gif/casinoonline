-- Pre-committed next server seed (docs/SPEC.md §4). Every user has exactly one: its SHA-256 is
-- shown before the player picks the client seed of the next pair, and POST /fairness/rotate
-- promotes it to the active pair. The server can no longer choose (grind) its seed after
-- seeing the client seed.

CREATE TABLE next_server_seeds (
  user_id bigint PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  server_seed text NOT NULL CHECK (server_seed ~ '^[0-9a-f]{64}$'),
  server_seed_hash text NOT NULL CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill existing users. Core PostgreSQL has no gen_random_bytes(): two random v4 UUIDs
-- (244 bits from the server's strong random source) are compressed by SHA-256 into 64 hex chars.
-- MATERIALIZED evaluates each seed once, so the hash is computed on the very seed stored.
WITH seeds AS MATERIALIZED (
  SELECT id AS user_id,
         encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')),
                'hex') AS server_seed
    FROM users
)
INSERT INTO next_server_seeds (user_id, server_seed, server_seed_hash)
SELECT user_id, server_seed, encode(sha256(convert_to(server_seed, 'UTF8')), 'hex')
  FROM seeds;
