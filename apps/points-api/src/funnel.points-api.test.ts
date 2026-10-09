// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Db } from "./db";
import { formatFunnel, readFunnel } from "./funnel";
import { createTestDb } from "./test-db";

const NOW = new Date("2026-10-09T00:00:00Z");
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * 86_400_000 + hours * 3_600_000);

async function device(db: Db, id: string, lastHeartbeat: Date | null = null) {
  await db.query("INSERT INTO devices (id, public_key_jwk, last_heartbeat_at) VALUES ($1, '{}', $2)", [id, lastHeartbeat]);
}
async function wallet(db: Db, address: string, deviceId: string, code: string) {
  await db.query("INSERT INTO wallets (address, device_id, invite_code) VALUES ($1, $2, $3)", [address, deviceId, code]);
}
async function redeem(db: Db, deviceId: string, code: string, at: Date) {
  await db.query("INSERT INTO invite_redemptions (device_id, code, redeemed_at) VALUES ($1, $2, $3)", [deviceId, code, at]);
}

async function seed() {
  const db = await createTestDb();
  await device(db, "d1");
  await wallet(db, "w1", "d1", "MEMBER01");
  await db.query("INSERT INTO drop_codes (code, seats, label) VALUES ('DROPAAAA', 3, 'X launch'), ('DROPUNLI', NULL, 'Reviewers')");

  // Member code MEMBER01: d2 claimed and retained, d3 never claimed, d9 claimed but too new.
  await device(db, "d2", new Date(ago(40).getTime() + 30 * 86_400_000));
  await wallet(db, "w2", "d2", "MEMBER02");
  await redeem(db, "d2", "MEMBER01", ago(40));
  await device(db, "d3");
  await redeem(db, "d3", "MEMBER01", ago(40));
  await device(db, "d9");
  await wallet(db, "w9", "d9", "MEMBER09");
  await redeem(db, "d9", "MEMBER01", ago(3));

  // MEMBER02: d4 never claimed.
  await device(db, "d4");
  await redeem(db, "d4", "MEMBER02", ago(10));

  // Drop code DROPAAAA: d5 claimed but stopped early, d6 and d7 never claimed.
  await device(db, "d5", new Date(ago(35).getTime() + 10 * 86_400_000));
  await wallet(db, "w5", "d5", "MEMBER05");
  await redeem(db, "d5", "DROPAAAA", ago(35));
  await device(db, "d6");
  await redeem(db, "d6", "DROPAAAA", ago(35, 2));
  await device(db, "d7");
  await redeem(db, "d7", "DROPAAAA", ago(35, 5));
  return db;
}

describe("readFunnel", () => {
  it("counts redemptions and claims by code kind", async () => {
    const funnel = await readFunnel(await seed(), NOW);
    expect(funnel.member).toEqual({ redemptions: 4, claims: 2, claimRate: 0.5 });
    expect(funnel.drop).toEqual({ redemptions: 3, claims: 1, claimRate: 1 / 3 });
  });

  it("counts refilled and unused member seats", async () => {
    const funnel = await readFunnel(await seed(), NOW);
    expect(funnel.seatsRefilled).toBe(2);
    // MEMBER01 holds d3 (2 left), MEMBER02 holds d4 (2 left), MEMBER05 and MEMBER09 have 3 each.
    expect(funnel.memberSeatsUnused).toBe(10);
  });

  it("reports each drop code's seats and drain time", async () => {
    const { dropCodes } = await readFunnel(await seed(), NOW);
    expect(dropCodes).toEqual([
      {
        code: "DROPAAAA",
        label: "X launch",
        seats: 3,
        used: 3,
        left: 0,
        firstRedeemedAt: ago(35),
        lastRedeemedAt: ago(35, 5),
        drainMs: 5 * 3_600_000,
      },
      {
        code: "DROPUNLI",
        label: "Reviewers",
        seats: null,
        used: 0,
        left: null,
        firstRedeemedAt: null,
        lastRedeemedAt: null,
        drainMs: null,
      },
    ]);
  });

  it("measures week-four retention over claimed redemptions at least 28 days old", async () => {
    const { retention } = await readFunnel(await seed(), NOW);
    expect(retention).toEqual({ eligible: 2, retained: 1, rate: 0.5 });
  });

  it("reports empty tables without dividing by zero", async () => {
    const funnel = await readFunnel(await createTestDb(), NOW);
    expect(funnel.member.claimRate).toBeNull();
    expect(funnel.retention.rate).toBeNull();
    expect(funnel.memberSeatsUnused).toBe(0);
  });

  it("formats a readable report", async () => {
    const text = formatFunnel(await readFunnel(await seed(), NOW));
    expect(text).toContain("Umami");
    expect(text).toContain("DROPAAAA");
  });
});
