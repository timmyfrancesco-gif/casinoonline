-- Initial schema (docs/SPEC.md §2). Amounts are integers in units (100 units = 1 chip).

CREATE TABLE users (
  id bigserial PRIMARY KEY,
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  age_confirmed_at timestamptz NOT NULL,
  reality_check_minutes int NOT NULL DEFAULT 30 CHECK (reality_check_minutes IN (15, 30, 60)),
  self_excluded_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

CREATE TABLE sessions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE wallets (
  user_id bigint PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  balance bigint NOT NULL CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seed_pairs (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  server_seed text NOT NULL CHECK (server_seed ~ '^[0-9a-f]{64}$'),
  server_seed_hash text NOT NULL CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
  client_seed text NOT NULL CHECK (char_length(client_seed) BETWEEN 1 AND 64),
  next_nonce int NOT NULL DEFAULT 0 CHECK (next_nonce >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz NULL,
  CHECK (active = (revealed_at IS NULL))
);
CREATE UNIQUE INDEX seed_pairs_one_active_per_user ON seed_pairs (user_id) WHERE active;
CREATE INDEX seed_pairs_user_id_idx ON seed_pairs (user_id, id DESC);

CREATE TABLE rounds (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('roulette', 'slot', 'blackjack', 'videopoker')),
  status text NOT NULL CHECK (status IN ('open', 'settled')),
  seed_pair_id bigint NOT NULL REFERENCES seed_pairs ON DELETE CASCADE,
  nonce int NOT NULL CHECK (nonce >= 0),
  stake bigint NOT NULL CHECK (stake >= 0),
  payout bigint NOT NULL DEFAULT 0 CHECK (payout >= 0),
  input jsonb NOT NULL,
  state jsonb NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz NULL,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (seed_pair_id, nonce),
  CHECK ((status = 'open') = (settled_at IS NULL)),
  CHECK (status = 'settled' OR payout = 0)
);
CREATE UNIQUE INDEX rounds_one_open_per_game ON rounds (user_id, game) WHERE status = 'open';
CREATE INDEX rounds_user_id_idx ON rounds (user_id, id DESC);
CREATE INDEX rounds_user_game_id_idx ON rounds (user_id, game, id DESC);

CREATE TABLE ledger (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  round_id bigint NULL REFERENCES rounds ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('initial', 'stake', 'payout', 'reset')),
  amount bigint NOT NULL,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'stake' AND amount < 0) OR (kind <> 'stake' AND amount > 0)),
  CHECK ((kind IN ('stake', 'payout')) = (round_id IS NOT NULL))
);
CREATE INDEX ledger_user_created_idx ON ledger (user_id, created_at);
CREATE INDEX ledger_round_id_idx ON ledger (round_id) WHERE round_id IS NOT NULL;

CREATE TABLE loss_limits (
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('24h', '7d', '30d')),
  value bigint NULL CHECK (value IS NULL OR value > 0),
  pending_set boolean NOT NULL DEFAULT false,
  pending_value bigint NULL CHECK (pending_value IS NULL OR pending_value > 0),
  pending_effective_at timestamptz NULL,
  PRIMARY KEY (user_id, period),
  CHECK (pending_set = (pending_effective_at IS NOT NULL)),
  CHECK (pending_set OR pending_value IS NULL)
);
