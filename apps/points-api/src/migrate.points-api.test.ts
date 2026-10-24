// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { dbFromPglite } from "./db";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("applies every migration once and records it", async () => {
    const db = dbFromPglite(new PGlite());

    expect(await migrate(db)).toEqual(["001_init.sql", "002_leave.sql", "003_founding_number.sql", "004_original_founder.sql", "005_invites.sql", "006_scans.sql", "007_bounty_daily_unique.sql", "008_attestation_unpaid_reason.sql", "009_wallet_devices.sql"]);
    expect(await migrate(db)).toEqual([]);

    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "attestations",
      "bounty_pool",
      "challenges",
      "devices",
      "drop_codes",
      "invite_redemptions",
      "points",
      "scan_points",
      "schema_migrations",
      "snapshot_runs",
      "snapshots",
      "wallet_devices",
      "wallets",
    ]);
  });

  it("backfills each existing wallet's install into wallet_devices", async () => {
    const db = dbFromPglite(new PGlite());
    await migrate(db);
    await db.query("DROP TABLE wallet_devices");
    await db.query("DELETE FROM schema_migrations WHERE name = '009_wallet_devices.sql'");
    await db.query("INSERT INTO devices (id, public_key_jwk) VALUES ('desktop', '{}')");
    await db.query("INSERT INTO wallets (address, device_id, invite_code) VALUES ('alice', 'desktop', 'ALICE001')");

    expect(await migrate(db)).toEqual(["009_wallet_devices.sql"]);

    const { rows } = await db.query("SELECT address, device_id FROM wallet_devices");
    expect(rows).toEqual([{ address: "alice", device_id: "desktop" }]);
  });
});
