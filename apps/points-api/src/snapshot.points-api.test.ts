// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Balances } from "./balances";
import type { Db } from "./db";
import { runSnapshot } from "./snapshot";
import { createTestDb } from "./test-db";

const NOW = new Date("2026-10-08T00:05:00Z");
const HOURS_AGO = new Date(NOW.getTime() - 2 * 3_600_000);
const DAYS_AGO = new Date(NOW.getTime() - 4 * 86_400_000);

async function seed(
  db: Db,
  wallets: { address: string; heartbeat: Date; referredBy?: string }[],
): Promise<void> {
  for (const [i, wallet] of wallets.entries()) {
    await db.query("INSERT INTO devices (id, public_key_jwk, last_heartbeat_at) VALUES ($1, '{}', $2)", [
      `device-${wallet.address}`,
      wallet.heartbeat,
    ]);
    await db.query("INSERT INTO wallets (address, device_id, invite_code, referred_by) VALUES ($1, $2, $3, $4)", [
      wallet.address,
      `device-${wallet.address}`,
      `CODE${i}`,
      wallet.referredBy ?? null,
    ]);
  }
}

function reader(balances: Record<string, Balances>) {
  return vi.fn(async (address: string) => {
    const found = balances[address];
    if (!found) throw new Error(`gateway down for ${address}`);
    return found;
  });
}

async function pointsByAddress(db: Db) {
  const { rows } = await db.query<{ address: string; holding: string; referee: string; referrer: string }>(
    `SELECT address, holding_atomic::text AS holding, referee_bonus_atomic::text AS referee,
            referrer_bonus_atomic::text AS referrer
       FROM points ORDER BY address`,
  );
  return Object.fromEntries(rows.map(({ address, ...rest }) => [address, rest]));
}

describe("runSnapshot", () => {
  it("credits live wallets and their referrers for the UTC day", async () => {
    const db = await createTestDb();
    await seed(db, [
      { address: "alice", heartbeat: HOURS_AGO },
      { address: "bob", heartbeat: HOURS_AGO, referredBy: "alice" },
    ]);

    const summary = await runSnapshot(db, NOW, {
      readBalances: reader({
        alice: { arAtomic: "1000", aoAtomic: "0" },
        bob: { arAtomic: "300", aoAtomic: "200" },
      }),
    });

    expect(summary).toEqual({ day: "2026-10-08", walletCount: 2, liveCount: 2, failedCount: 0 });
    expect(await pointsByAddress(db)).toEqual({
      alice: { holding: "1000", referee: "0", referrer: "50" },
      bob: { holding: "500", referee: "50", referrer: "0" },
    });
  });

  it("doesn't read balances for wallets whose install went quiet, and credits them nothing", async () => {
    const db = await createTestDb();
    await seed(db, [{ address: "gone", heartbeat: DAYS_AGO }]);
    const readBalances = reader({});

    const summary = await runSnapshot(db, NOW, { readBalances });

    expect(readBalances).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ liveCount: 0, failedCount: 0 });
    expect(await pointsByAddress(db)).toEqual({});
    const { rows } = await db.query<{ live: boolean }>("SELECT live FROM snapshots WHERE address = 'gone'");
    expect(rows[0]?.live).toBe(false);
  });

  it("retries a failing read, then leaves the wallet out of the day", async () => {
    const db = await createTestDb();
    await seed(db, [
      { address: "ok", heartbeat: HOURS_AGO },
      { address: "flaky", heartbeat: HOURS_AGO },
    ]);
    const readBalances = reader({ ok: { arAtomic: "1", aoAtomic: "1" } });

    const summary = await runSnapshot(db, NOW, { readBalances, retryDelayMs: 0 });

    expect(readBalances.mock.calls.filter(([address]) => address === "flaky")).toHaveLength(3);
    expect(summary).toMatchObject({ walletCount: 2, liveCount: 1, failedCount: 1 });
    expect(Object.keys(await pointsByAddress(db))).toEqual(["ok"]);
  });

  it("runs once per day", async () => {
    const db = await createTestDb();
    await seed(db, [{ address: "alice", heartbeat: HOURS_AGO }]);
    const readBalances = reader({ alice: { arAtomic: "1", aoAtomic: "0" } });

    await runSnapshot(db, NOW, { readBalances });
    const second = await runSnapshot(db, new Date(NOW.getTime() + 3_600_000), { readBalances });

    expect(second).toBeNull();
    expect(readBalances).toHaveBeenCalledTimes(1);
  });

  it("records an empty day when nobody has registered", async () => {
    const db = await createTestDb();

    expect(await runSnapshot(db, NOW, { readBalances: reader({}) })).toMatchObject({ walletCount: 0 });
  });
});
