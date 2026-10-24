-- Every install a wallet is registered on, so the same wallet on desktop
-- and phone stays on both installs' Points screens and is live while
-- either one checks in. `wallets.device_id` stays the newest install,
-- which the whale curve groups by.
CREATE TABLE wallet_devices (
  address text NOT NULL REFERENCES wallets (address) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices (id),
  PRIMARY KEY (address, device_id)
);
CREATE INDEX wallet_devices_device_id ON wallet_devices (device_id);

INSERT INTO wallet_devices (address, device_id) SELECT address, device_id FROM wallets;
