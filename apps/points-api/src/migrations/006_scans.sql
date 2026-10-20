-- Community release scans (SCANS.md). A challenge is issued unsigned and
-- single use: `used_by_attestation` is set in the same transaction that
-- inserts the attestation, under a row lock.
CREATE TABLE challenges (
  id text PRIMARY KEY,
  release text NOT NULL,
  commit text NOT NULL,
  functions jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_by_attestation text
);
CREATE INDEX challenges_expires_at ON challenges (expires_at);

-- Attestations are public, signed records served by GET /attestations, so
-- they outlive the wallet: `address` has no foreign key and leaving
-- doesn't delete them. The address stays in the unique key, so a wallet
-- can't leave and rejoin to attest the same release again.
-- `body` is the parsed attestation; its canonical JSON hashes to `id`.
CREATE TABLE attestations (
  id text PRIMARY KEY,
  release text NOT NULL,
  commit text NOT NULL,
  challenge_id text NOT NULL UNIQUE REFERENCES challenges (id),
  address text NOT NULL,
  owner text NOT NULL,
  signature text NOT NULL,
  proof text NOT NULL CHECK (proof IN ('message', 'transaction')),
  message text NOT NULL,
  body jsonb NOT NULL,
  paid boolean NOT NULL,
  created_at timestamptz NOT NULL,
  voided_at timestamptz,
  -- The release's checking-function count when accepted, so an old release's
  -- coverage needs no GitHub call. Null for a row written without it.
  function_total integer,
  UNIQUE (address, release)
);
CREATE INDEX attestations_release ON attestations (release, created_at);

-- Points from scans and accepted findings. Unlike `points` they aren't per
-- day. They go with the wallet when it leaves, as its other points do.
-- `ref` (a finding's PR or advisory URL) is unique so it can't be paid twice.
CREATE TABLE scan_points (
  id bigserial PRIMARY KEY,
  address text NOT NULL REFERENCES wallets (address) ON DELETE CASCADE,
  attestation_id text NOT NULL REFERENCES attestations (id),
  kind text NOT NULL CHECK (kind IN ('scan', 'finding')),
  amount_atomic numeric(40, 0) NOT NULL,
  ref text,
  created_at timestamptz NOT NULL
);
CREATE INDEX scan_points_address ON scan_points (address);
CREATE UNIQUE INDEX scan_points_ref ON scan_points (ref) WHERE ref IS NOT NULL;

-- Append-only; the balance is the sum of `delta_atomic`.
CREATE TABLE bounty_pool (
  id bigserial PRIMARY KEY,
  day date,
  delta_atomic numeric(40, 0) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('daily', 'award')),
  attestation_id text REFERENCES attestations (id),
  ref text,
  created_at timestamptz NOT NULL
);
