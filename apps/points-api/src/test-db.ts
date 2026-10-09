import { PGlite } from "@electric-sql/pglite";
import { dbFromPglite, type Db } from "./db";
import { migrate } from "./migrate";
import type { TestDevice } from "./test-signers";

/** A fresh, fully migrated in-memory Postgres for one test. */
export async function createTestDb(): Promise<Db> {
  const db = dbFromPglite(new PGlite());
  await migrate(db);
  return db;
}

/**
 * Records a redemption for the install, as `/invite/redeem` would, so it
 * may register a new wallet in Phase 1. The code isn't checked.
 */
export async function admitInstall(db: Db, device: TestDevice, code = "TESTDROP"): Promise<void> {
  await db.query("INSERT INTO devices (id, public_key_jwk) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [
    device.id,
    JSON.stringify(device.publicKey),
  ]);
  await db.query(
    "INSERT INTO invite_redemptions (device_id, code, redeemed_at) VALUES ($1, $2, now()) ON CONFLICT (device_id) DO NOTHING",
    [device.id, code],
  );
}
