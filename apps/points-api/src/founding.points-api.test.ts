// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "./app";
import { dbFromPglite, type Db } from "./db";
import { migrate } from "./migrate";
import { admitInstall, createTestDb } from "./test-db";
import {
  createTestDevice,
  createTestWallet,
  deviceBody,
  leaveBody,
  registerBody,
  type TestDevice,
  type TestWallet,
} from "./test-signers";

const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

let wallets: TestWallet[];

beforeAll(async () => {
  wallets = await Promise.all([createTestWallet(), createTestWallet(), createTestWallet()]);
}, 90_000);

function setup(db: Db, deps: Partial<AppDeps> = {}) {
  let n = 0;
  const app = createApp({
    db,
    now: () => NOW,
    newInviteCode: () => `CODE${String(n++).padStart(4, "0")}`,
    ...deps,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const register = async (wallet: TestWallet, device?: TestDevice) => {
    const install = device ?? (await createTestDevice());
    await admitInstall(db, install);
    return post("/register", await registerBody(wallet, install, { issuedAt: NOW_SECONDS }));
  };
  return { app, post, register };
}

const numbers = async (db: Db) =>
  (await db.query<{ address: string; founding_number: number | null }>("SELECT address, founding_number FROM wallets"))
    .rows;

describe("founding numbers", () => {
  it("backfills existing wallets in registration order, tie-broken by address", async () => {
    const db = dbFromPglite(new PGlite());
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    // Apply 001 and 002 only, seed wallets, then run the full migration set.
    for (const name of ["001_init.sql", "002_leave.sql"]) {
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
      for (const statement of sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .split(";")) {
        if (statement.trim()) await db.query(statement);
      }
      await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    }
    await db.query("INSERT INTO devices (id, public_key_jwk, last_heartbeat_at) VALUES ('d', '{}', now())");
    const insert = (address: string, at: string) =>
      db.query("INSERT INTO wallets (address, device_id, invite_code, registered_at) VALUES ($1, 'd', $2, $3)", [
        address,
        `code-${address}`,
        at,
      ]);
    await insert("zeta", "2026-01-02T00:00:00Z");
    await insert("beta", "2026-01-03T00:00:00Z");
    await insert("alpha", "2026-01-03T00:00:00Z");
    await insert("omega", "2026-01-01T00:00:00Z");

    expect(await migrate(db)).toEqual(["003_founding_number.sql", "004_original_founder.sql", "005_invites.sql"]);

    const { rows } = await db.query<{
      address: string;
      founding_number: number;
    }>("SELECT address, founding_number FROM wallets ORDER BY founding_number");
    expect(rows.map((r) => r.address)).toEqual(["omega", "zeta", "alpha", "beta"]);
    expect(rows.map((r) => r.founding_number)).toEqual([1, 2, 3, 4]);
    const next = await db.query<{ n: string }>("SELECT nextval('founding_number_seq')::text AS n");
    expect(next.rows[0]?.n).toBe("5");
  });

  it("flags only the wallets numbered before the original-founder migration", async () => {
    const db = dbFromPglite(new PGlite());
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of ["001_init.sql", "002_leave.sql", "003_founding_number.sql"]) {
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
      for (const statement of sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .split(";")) {
        if (statement.trim()) await db.query(statement);
      }
      await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    }
    await db.query("INSERT INTO devices (id, public_key_jwk, last_heartbeat_at) VALUES ('d', '{}', now())");
    await db.query("INSERT INTO wallets (address, device_id, invite_code, founding_number) VALUES ('member', 'd', 'c1', 1)");
    await db.query(
      "INSERT INTO wallets (address, device_id, invite_code, founding_number) VALUES ('unnumbered', 'd', 'c2', NULL)",
    );

    await migrate(db);

    const { rows } = await db.query<{ address: string; original_founder: boolean }>(
      "SELECT address, original_founder FROM wallets ORDER BY address",
    );
    expect(rows).toEqual([
      { address: "member", original_founder: true },
      { address: "unnumbered", original_founder: false },
    ]);
  });

  it("numbers a Phase 1 joiner without making it an original founder", async () => {
    const db = await createTestDb();
    const { register } = setup(db);

    await register(wallets[0]!);

    const { rows } = await db.query("SELECT founding_number, original_founder FROM wallets");
    expect(rows).toEqual([{ founding_number: 1, original_founder: false }]);
  });

  it("assigns the next number to each new wallet in Phase 1 and keeps it on re-register", async () => {
    const db = await createTestDb();
    const { register } = setup(db);
    const device = await createTestDevice();

    await register(wallets[0]!, device);
    await register(wallets[1]!);
    await register(wallets[0]!, device);

    const byAddress = Object.fromEntries((await numbers(db)).map((r) => [r.address, r.founding_number]));
    expect(byAddress).toEqual({
      [wallets[0]!.address]: 1,
      [wallets[1]!.address]: 2,
    });
    await register(wallets[2]!);
    expect((await numbers(db)).find((r) => r.address === wallets[2]!.address)?.founding_number).toBe(3);
  });

  it("leaves wallets registered in Phase 2 without a number", async () => {
    const db = await createTestDb();
    const { register } = setup(db, { pointsPhase: 2 });

    await register(wallets[0]!);

    expect(await numbers(db)).toEqual([{ address: wallets[0]!.address, founding_number: null }]);
  });

  it("never reuses a number after the top-numbered wallet leaves", async () => {
    const db = await createTestDb();
    const { post, register } = setup(db);
    await register(wallets[0]!);
    const device = await createTestDevice();
    await register(wallets[1]!, device);

    const left = await post("/leave", await leaveBody(wallets[1]!, NOW_SECONDS));
    expect(left.status).toBe(200);
    await register(wallets[2]!);

    const found = Object.fromEntries((await numbers(db)).map((r) => [r.address, r.founding_number]));
    expect(found).toEqual({
      [wallets[0]!.address]: 1,
      [wallets[2]!.address]: 3,
    });
  });

  it("returns the number from /me", async () => {
    const db = await createTestDb();
    const { post, register } = setup(db);
    const device = await createTestDevice();
    await register(wallets[0]!, device);

    const response = await post("/me", await deviceBody(device, "me", NOW_SECONDS));

    const json = (await response.json()) as {
      wallets: { foundingNumber: number | null }[];
    };
    expect(json.wallets.map((w) => w.foundingNumber)).toEqual([1]);
  });
});

describe("GET /stats", () => {
  it("counts founding members, caches for a minute and allows any origin", async () => {
    const db = await createTestDb();
    let clock = NOW.getTime();
    const { app, register } = setup(db, { now: () => new Date(clock) });
    const stats = async () => {
      const response = await app.request("/stats");
      return {
        body: await response.json(),
        cors: response.headers.get("access-control-allow-origin"),
        cache: response.headers.get("cache-control"),
      };
    };

    expect((await stats()).body).toEqual({ foundingMembers: 0 });
    await register(wallets[0]!);
    expect((await stats()).body).toEqual({ foundingMembers: 0 });

    clock += 60_000;
    const fresh = await stats();
    expect(fresh.body).toEqual({ foundingMembers: 1 });
    expect(fresh.cors).toBe("*");
    expect(fresh.cache).toBe("public, max-age=60");
  });

  it("doesn't count wallets registered after Phase 1", async () => {
    const db = await createTestDb();
    const { app, register } = setup(db, { pointsPhase: 2 });
    await register(wallets[0]!);

    expect(await (await app.request("/stats")).json()).toEqual({
      foundingMembers: 0,
    });
  });
});
