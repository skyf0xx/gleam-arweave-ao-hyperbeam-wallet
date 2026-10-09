-- Team-made codes that let in a fixed number of installs. A NULL seats
-- value means unlimited. Codes share one namespace with wallets.invite_code;
-- both writers check the other table before inserting.
CREATE TABLE drop_codes (
  code text PRIMARY KEY,
  seats integer CHECK (seats >= 0),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One redemption per install, deleted with its device. No foreign key on
-- code: it may be a member code whose wallet has since left, and the
-- redemption still belongs to the install it let in.
CREATE TABLE invite_redemptions (
  device_id text PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
  code text NOT NULL,
  redeemed_at timestamptz NOT NULL
);
CREATE INDEX invite_redemptions_code ON invite_redemptions (code);
