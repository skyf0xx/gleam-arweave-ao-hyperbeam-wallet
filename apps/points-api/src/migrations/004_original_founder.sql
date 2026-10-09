-- Set once by this backfill and never at registration: Phase 1 joiners get
-- a founding number too, but they came in with a code and are not founders.
ALTER TABLE wallets ADD COLUMN original_founder boolean NOT NULL DEFAULT false;

UPDATE wallets SET original_founder = true WHERE founding_number IS NOT NULL;

ALTER TABLE points ADD COLUMN founder_bonus_atomic numeric(40, 0) NOT NULL DEFAULT 0;
