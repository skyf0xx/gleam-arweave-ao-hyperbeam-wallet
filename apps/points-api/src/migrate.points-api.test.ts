// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { dbFromPglite } from "./db";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("applies every migration once and records it", async () => {
    const db = dbFromPglite(new PGlite());

    expect(await migrate(db)).toEqual(["001_init.sql", "002_leave.sql"]);
    expect(await migrate(db)).toEqual([]);

    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "devices",
      "points",
      "schema_migrations",
      "snapshot_runs",
      "snapshots",
      "wallets",
    ]);
  });
});
