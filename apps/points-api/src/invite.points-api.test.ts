// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "./app";
import type { Db } from "./db";
import { runSnapshot } from "./snapshot";
import { createTestDb } from "./test-db";
import {
  createTestDevice,
  createTestWallet,
  deviceBody,
  leaveBody,
  redeemBody,
  registerBody,
  type TestDevice,
  type TestWallet,
} from "./test-signers";

const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

let alice: TestWallet;
let bob: TestWallet;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestWallet(), createTestWallet()]);
}, 90_000);

async function setup(deps: Partial<AppDeps> = {}) {
  const db = await createTestDb();
  const codes = ["ALICE001", "BOB00002", "CAROL003"];
  const app = createApp({ db, now: () => NOW, newInviteCode: () => codes.shift()!, ...deps });
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, json: (await response.json()) as Record<string, unknown> };
  };
  const check = (code: unknown) => post("/invite/check", { code });
  const redeem = async (device: TestDevice, code: string) => post("/invite/redeem", await redeemBody(device, code, NOW_SECONDS));
  const register = async (wallet: TestWallet, device: TestDevice, inviteCode?: string) =>
    post("/register", await registerBody(wallet, device, { inviteCode, issuedAt: NOW_SECONDS }));
  const me = async (device: TestDevice) => post("/me", await deviceBody(device, "me", NOW_SECONDS));
  return { db, app, post, check, redeem, register, me };
}

async function addDropCode(db: Db, code: string, seats: number | null) {
  await db.query("INSERT INTO drop_codes (code, seats, label) VALUES ($1, $2, 'test')", [code, seats]);
}

/** A member who joined before invites were required, so holds no redemption. */
async function addMember(db: Db, wallet: TestWallet, device: TestDevice) {
  await db.query("INSERT INTO devices (id, public_key_jwk) VALUES ($1, $2)", [device.id, JSON.stringify(device.publicKey)]);
  await db.query(
    "INSERT INTO wallets (address, device_id, invite_code, founding_number) VALUES ($1, $2, 'ALICE001', nextval('founding_number_seq'))",
    [wallet.address, device.id],
  );
}

async function redemptions(db: Db) {
  const { rows } = await db.query<{ device_id: string; code: string }>(
    "SELECT device_id, code FROM invite_redemptions ORDER BY redeemed_at, device_id",
  );
  return rows;
}

describe("POST /invite/redeem", () => {
  it("takes a seat on a member code and creates the install's device row", async () => {
    const { db, check, redeem } = await setup();
    await addMember(db, alice, await createTestDevice());
    const newcomer = await createTestDevice();

    const { status, json } = await redeem(newcomer, "ALICE001");

    expect(status).toBe(200);
    expect(json).toEqual({ result: "ok" });
    expect(await redemptions(db)).toEqual([{ device_id: newcomer.id, code: "ALICE001" }]);
    const device = await db.query<{ public_key_jwk: unknown }>("SELECT public_key_jwk FROM devices WHERE id = $1", [
      newcomer.id,
    ]);
    expect(device.rows[0]?.public_key_jwk).toEqual(newcomer.publicKey);
    expect(Object.keys(device.rows[0]!.public_key_jwk as object).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect((await check("ALICE001")).json).toEqual({ exists: true, kind: "member", seatsLeft: 2 });
  });

  it("answers ok again from the same install without another seat, whatever code it sends", async () => {
    const { db, check, redeem } = await setup();
    await addMember(db, alice, await createTestDevice());
    await addDropCode(db, "GLEAMDROP7", 5);
    const newcomer = await createTestDevice();
    await redeem(newcomer, "ALICE001");

    expect((await redeem(newcomer, "ALICE001")).json).toEqual({ result: "ok" });
    expect((await redeem(newcomer, "GLEAMDROP7")).json).toEqual({ result: "ok" });
    expect((await redeem(newcomer, "NOSUCHCODE")).json).toEqual({ result: "ok" });

    expect(await redemptions(db)).toEqual([{ device_id: newcomer.id, code: "ALICE001" }]);
    expect((await check("ALICE001")).json.seatsLeft).toBe(2);
    expect((await check("GLEAMDROP7")).json.seatsLeft).toBe(5);
  });

  it("answers full once a member code's 3 seats are taken", async () => {
    const { db, check, redeem } = await setup();
    await addMember(db, alice, await createTestDevice());
    for (let i = 0; i < 3; i++) expect((await redeem(await createTestDevice(), "ALICE001")).json.result).toBe("ok");

    const late = await createTestDevice();
    expect((await redeem(late, "ALICE001")).json).toEqual({ result: "full" });
    expect((await db.query("SELECT 1 FROM devices WHERE id = $1", [late.id])).rows).toEqual([]);
    expect((await check("ALICE001")).json).toEqual({ exists: true, kind: "member", seatsLeft: 0 });
    expect(await redemptions(db)).toHaveLength(3);
  });

  it("answers unknown for a code nobody holds, storing nothing", async () => {
    const { db, redeem } = await setup();
    const newcomer = await createTestDevice();

    expect((await redeem(newcomer, "NOSUCHCODE")).json).toEqual({ result: "unknown" });
    expect(await redemptions(db)).toEqual([]);
    expect((await db.query("SELECT 1 FROM devices WHERE id = $1", [newcomer.id])).rows).toEqual([]);
  });

  it("hands a seat back when an install it let in registers a wallet", async () => {
    const { db, check, post, redeem, register, me } = await setup();
    const alicesDevice = await createTestDevice();
    await addMember(db, alice, alicesDevice);
    const letIn = await createTestDevice();
    await redeem(letIn, "ALICE001");
    await redeem(await createTestDevice(), "ALICE001");
    await redeem(await createTestDevice(), "ALICE001");
    expect((await check("ALICE001")).json.seatsLeft).toBe(0);

    await register(bob, letIn, "ALICE001");

    expect((await check("ALICE001")).json.seatsLeft).toBe(1);
    expect(((await me(alicesDevice)).json.wallets as { seatsLeft: number }[])[0]?.seatsLeft).toBe(1);
    expect((await redeem(await createTestDevice(), "ALICE001")).json.result).toBe("ok");
    expect((await check("ALICE001")).json.seatsLeft).toBe(0);

    // The let-in install leaving deletes its redemption, which no longer held a seat.
    expect((await post("/leave", await leaveBody(bob, NOW_SECONDS))).status).toBe(200);
    expect((await check("ALICE001")).json.seatsLeft).toBe(0);
    expect((await redemptions(db)).some((r) => r.device_id === letIn.id)).toBe(false);
  });

  it("limits a drop code to its seats and leaves a NULL-seat code unlimited", async () => {
    const { db, check, redeem } = await setup();
    await addDropCode(db, "GLEAMDROP7", 2);
    await addDropCode(db, "REVIEWERS", null);

    expect((await redeem(await createTestDevice(), "GLEAMDROP7")).json.result).toBe("ok");
    expect((await check("GLEAMDROP7")).json).toEqual({ exists: true, kind: "drop", seatsLeft: 1 });
    expect((await redeem(await createTestDevice(), "GLEAMDROP7")).json.result).toBe("ok");
    expect((await redeem(await createTestDevice(), "GLEAMDROP7")).json.result).toBe("full");

    for (let i = 0; i < 4; i++) expect((await redeem(await createTestDevice(), "REVIEWERS")).json.result).toBe("ok");
    expect((await check("REVIEWERS")).json).toEqual({ exists: true, kind: "drop", seatsLeft: null });
  });

  it("never answers full in Phase 2, but still records redemptions and rejects unknown codes", async () => {
    const { db, check, redeem, register, me } = await setup({ pointsPhase: 2 });
    const alicesDevice = await createTestDevice();
    await register(alice, alicesDevice);
    await addDropCode(db, "GLEAMDROP7", 1);

    for (let i = 0; i < 4; i++) expect((await redeem(await createTestDevice(), "ALICE001")).json.result).toBe("ok");
    for (let i = 0; i < 2; i++) expect((await redeem(await createTestDevice(), "GLEAMDROP7")).json.result).toBe("ok");
    expect((await redeem(await createTestDevice(), "NOSUCHCODE")).json.result).toBe("unknown");

    expect((await check("ALICE001")).json).toEqual({ exists: true, kind: "member", seatsLeft: null });
    expect((await check("GLEAMDROP7")).json).toEqual({ exists: true, kind: "drop", seatsLeft: null });
    expect(((await me(alicesDevice)).json.wallets as { seatsLeft: number | null }[])[0]?.seatsLeft).toBeNull();
    expect(await redemptions(db)).toHaveLength(6);
  });

  it("lets only one of two concurrent installs take a code's last seat", async () => {
    // PGlite runs transactions one at a time, so this pins the outcome; the
    // FOR UPDATE on the code's row is what enforces it on a real Postgres.
    const { db, redeem } = await setup();
    await addDropCode(db, "GLEAMDROP7", 1);

    const results = await Promise.all([
      redeem(await createTestDevice(), "GLEAMDROP7"),
      redeem(await createTestDevice(), "GLEAMDROP7"),
    ]);

    expect(results.map((r) => r.json.result).sort()).toEqual(["full", "ok"]);
    expect(await redemptions(db)).toHaveLength(1);
  });

  it("stores only the key's kty, crv, x and y", async () => {
    const { db, post } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    const device = await createTestDevice();
    const body = await redeemBody(device, "GLEAMDROP7", NOW_SECONDS);

    await post("/invite/redeem", { ...body, devicePublicKey: { ...device.publicKey, ext: true, note: "extra" } });

    const stored = await db.query<{ public_key_jwk: unknown }>("SELECT public_key_jwk FROM devices WHERE id = $1", [
      device.id,
    ]);
    expect(stored.rows[0]?.public_key_jwk).toEqual(device.publicKey);
  });

  it("normalises the code and rejects a malformed one", async () => {
    const { db, post } = await setup();
    await addMember(db, alice, await createTestDevice());
    const device = await createTestDevice();

    const malformed = await post("/invite/redeem", { ...(await redeemBody(device, "ALICE001", NOW_SECONDS)), code: "a!" });
    expect(malformed.status).toBe(400);

    const lowercase = await post("/invite/redeem", {
      ...(await redeemBody(device, "ALICE001", NOW_SECONDS)),
      code: " alice001 ",
    });
    expect(lowercase.json).toEqual({ result: "ok" });
    expect(await redemptions(db)).toEqual([{ device_id: device.id, code: "ALICE001" }]);
  });

  it("rejects a signed code that differs from the body's", async () => {
    const { db, post } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    await addDropCode(db, "GLEAMDROP8", 5);
    const body = await redeemBody(await createTestDevice(), "GLEAMDROP7", NOW_SECONDS);

    expect((await post("/invite/redeem", { ...body, code: "GLEAMDROP8" })).status).toBe(400);
    expect(await redemptions(db)).toEqual([]);
  });

  it("rejects a stale message and a signature from another key", async () => {
    const { db, post } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    const device = await createTestDevice();
    const impostor = await createTestDevice();

    const stale = await post("/invite/redeem", await redeemBody(device, "GLEAMDROP7", NOW_SECONDS - 3600));
    const forged = await post("/invite/redeem", {
      ...(await redeemBody(impostor, "GLEAMDROP7", NOW_SECONDS)),
      devicePublicKey: device.publicKey,
    });

    expect(stale.status).toBe(401);
    expect(forged.status).toBe(401);
    expect(await redemptions(db)).toEqual([]);
    expect((await db.query("SELECT 1 FROM devices")).rows).toEqual([]);
  });

  it("isn't open to other origins", async () => {
    const { db, post } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);

    const response = await post("/invite/redeem", await redeemBody(await createTestDevice(), "GLEAMDROP7", NOW_SECONDS), {
      origin: "https://example.com",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST /invite/check", () => {
  it("reports an unknown code without a kind or seats", async () => {
    const { check } = await setup();

    expect((await check("NOSUCHCODE")).json).toEqual({ exists: false, kind: null, seatsLeft: null });
  });

  it("normalises the code, rejects a malformed one and is open to other origins", async () => {
    const { db, check, post } = await setup();
    await addMember(db, alice, await createTestDevice());

    expect((await check("  alice001")).json).toEqual({ exists: true, kind: "member", seatsLeft: 3 });
    expect((await check("ab")).status).toBe(400);
    expect((await check(42)).status).toBe(400);
    expect((await post("/invite/check", null)).status).toBe(400);
    const cors = await post("/invite/check", { code: "ALICE001" }, { origin: "https://gleam-permaweb.vercel.app" });
    expect(cors.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("shares one per-IP limit with redeem", async () => {
    const { db, post } = await setup();
    await addDropCode(db, "GLEAMDROP7", null);
    const ip = { "x-forwarded-for": "203.0.113.7" };

    for (let i = 0; i < 20; i++) expect((await post("/invite/check", { code: "GLEAMDROP7" }, ip)).status).toBe(200);
    for (let i = 0; i < 10; i++) {
      const body = await redeemBody(await createTestDevice(), "GLEAMDROP7", NOW_SECONDS);
      expect((await post("/invite/redeem", body, ip)).status).toBe(200);
    }

    expect((await post("/invite/check", { code: "GLEAMDROP7" }, ip)).status).toBe(429);
    expect((await post("/invite/redeem", await redeemBody(await createTestDevice(), "GLEAMDROP7", NOW_SECONDS), ip)).status).toBe(429);
    expect((await post("/invite/check", { code: "GLEAMDROP7" }, { "x-forwarded-for": "203.0.113.8" })).status).toBe(200);
  });
});

describe("invites alongside registration", () => {
  it("gives a wallet that registers with a drop code no referrer", async () => {
    const { db, redeem, register } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    const device = await createTestDevice();
    await redeem(device, "GLEAMDROP7");

    const { json } = await register(alice, device, "GLEAMDROP7");

    expect(json).toMatchObject({ address: alice.address, referred: false });
  });

  it("never gives a wallet a member code that a drop code already uses", async () => {
    const { db, redeem, register } = await setup({ newInviteCode: (() => {
      const codes = ["GLEAMDROP7", "ALICE001"];
      return () => codes.shift()!;
    })() });
    await addDropCode(db, "GLEAMDROP7", 5);
    const device = await createTestDevice();
    await redeem(device, "GLEAMDROP7");

    const { json } = await register(alice, device);

    expect(json.inviteCode).toBe("ALICE001");
    const numbers = await db.query<{ founding_number: number }>("SELECT founding_number FROM wallets");
    expect(numbers.rows).toEqual([{ founding_number: 1 }]);
  });

  it("deletes an install's redemption with its device when its last wallet leaves", async () => {
    const { db, post, redeem, register } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    const device = await createTestDevice();
    await redeem(device, "GLEAMDROP7");
    await register(alice, device);

    expect((await post("/leave", await leaveBody(alice, NOW_SECONDS))).status).toBe(200);

    expect(await redemptions(db)).toEqual([]);
    expect((await db.query("SELECT 1 FROM devices WHERE id = $1", [device.id])).rows).toEqual([]);
  });

  it("keeps a redemption whose install never joins, without disturbing snapshots or /me", async () => {
    const { db, post, redeem } = await setup();
    await addDropCode(db, "GLEAMDROP7", 5);
    const lurker = await createTestDevice();
    await redeem(lurker, "GLEAMDROP7");
    await addMember(db, alice, await createTestDevice());

    const summary = await runSnapshot(db, NOW, { readBalances: async () => ({ arAtomic: "100", aoAtomic: "0" }) });
    const lurkersView = await post("/me", await deviceBody(lurker, "me", NOW_SECONDS));

    expect(summary?.walletCount).toBe(1);
    expect(lurkersView.json).toEqual({ settledAt: expect.any(String), wallets: [] });
    expect(await redemptions(db)).toEqual([{ device_id: lurker.id, code: "GLEAMDROP7" }]);
  });
});
