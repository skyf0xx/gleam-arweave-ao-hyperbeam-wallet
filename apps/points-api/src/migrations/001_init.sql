-- A device is one extension install, identified by its P-256 key's
-- RFC 7638 thumbprint.
CREATE TABLE devices (
  id text PRIMARY KEY,
  public_key_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz
);

CREATE TABLE wallets (
  address text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices (id),
  invite_code text NOT NULL UNIQUE,
  referred_by text REFERENCES wallets (address),
  registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallets_device_id ON wallets (device_id);
CREATE INDEX wallets_referred_by ON wallets (referred_by);

-- Balances are atomic integers; numeric(40, 0) holds any u128.
CREATE TABLE snapshots (
  day date NOT NULL,
  address text NOT NULL REFERENCES wallets (address),
  ar_atomic numeric(40, 0) NOT NULL,
  ao_atomic numeric(40, 0) NOT NULL,
  live boolean NOT NULL,
  PRIMARY KEY (day, address)
);

CREATE TABLE points (
  day date NOT NULL,
  address text NOT NULL REFERENCES wallets (address),
  holding_atomic numeric(40, 0) NOT NULL,
  referee_bonus_atomic numeric(40, 0) NOT NULL,
  referrer_bonus_atomic numeric(40, 0) NOT NULL,
  PRIMARY KEY (day, address)
);
CREATE INDEX points_address ON points (address);

-- One row per completed daily run; its presence makes the run idempotent.
CREATE TABLE snapshot_runs (
  day date PRIMARY KEY,
  completed_at timestamptz NOT NULL,
  wallet_count integer NOT NULL,
  failed_count integer NOT NULL
);
