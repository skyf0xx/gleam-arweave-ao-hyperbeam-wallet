-- Leaving deletes a wallet's row, so its history goes with it and any
-- wallet it invited simply stops being credited as invited.
ALTER TABLE snapshots DROP CONSTRAINT snapshots_address_fkey;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_address_fkey
  FOREIGN KEY (address) REFERENCES wallets (address) ON DELETE CASCADE;

ALTER TABLE points DROP CONSTRAINT points_address_fkey;
ALTER TABLE points ADD CONSTRAINT points_address_fkey
  FOREIGN KEY (address) REFERENCES wallets (address) ON DELETE CASCADE;

ALTER TABLE wallets DROP CONSTRAINT wallets_referred_by_fkey;
ALTER TABLE wallets ADD CONSTRAINT wallets_referred_by_fkey
  FOREIGN KEY (referred_by) REFERENCES wallets (address) ON DELETE SET NULL;
