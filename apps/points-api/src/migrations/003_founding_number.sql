-- A sequence rather than MAX()+1: it is atomic across concurrent
-- registrations and never hands out a number again after a wallet leaves.
ALTER TABLE wallets ADD COLUMN founding_number integer UNIQUE;

UPDATE wallets SET founding_number = numbered.n
  FROM (SELECT address, row_number() OVER (ORDER BY registered_at, address) AS n FROM wallets) AS numbered
 WHERE wallets.address = numbered.address;

CREATE SEQUENCE founding_number_seq;

SELECT setval('founding_number_seq', coalesce((SELECT max(founding_number) FROM wallets), 0) + 1, false);
