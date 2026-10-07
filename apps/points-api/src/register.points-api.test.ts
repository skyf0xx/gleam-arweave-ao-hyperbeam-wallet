// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { Db } from "./db";
import { createTestDb } from "./test-db";
import { createTestDevice, createTestWallet, registerBody, type TestWallet } from "./test-signers";

const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

let alice: TestWallet;
let bob: TestWallet;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestWallet(), createTestWallet()]);
}, 60_000);

function setup(db: Db) {
  let next = 0;
  const codes = ["ALICE001", "BOB00002", "CAROL003", "DAVE0004"];
  return createApp({ db, now: () => NOW, newInviteCode: () => codes[next++]! });
}

async function post(app: ReturnType<typeof setup>, body: unknown) {
  const response = await app.request("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("POST /register", () => {
  it("registers a wallet, returns its invite code and marks the device live", async () => {
    const db = await createTestDb();
    const device = await createTestDevice();

    const { status, json } = await post(setup(db), await registerBody(alice, device, { issuedAt: NOW_SECONDS }));

    expect(status).toBe(200);
    expect(json).toEqual({ address: alice.address, inviteCode: "ALICE001", referred: false });
    const { rows } = await db.query<{ last_heartbeat_at: Date }>("SELECT last_heartbeat_at FROM devices");
    expect(rows[0]?.last_heartbeat_at.toISOString()).toBe(NOW.toISOString());
  });

  it("credits an invite code on the install's first wallet", async () => {
    const db = await createTestDb();
    const app = setup(db);
    await post(app, await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS }));

    const { json } = await post(
      app,
      await registerBody(bob, await createTestDevice(), { inviteCode: "ALICE001", issuedAt: NOW_SECONDS }),
    );

    expect(json).toMatchObject({ address: bob.address, referred: true });
    const { rows } = await db.query<{ referred_by: string }>("SELECT referred_by FROM wallets WHERE address = $1", [
      bob.address,
    ]);
    expect(rows[0]?.referred_by).toBe(alice.address);
  });

  it("ignores an invite code on an install's second wallet and an unknown code", async () => {
    const db = await createTestDb();
    const app = setup(db);
    const shared = await createTestDevice();
    await post(app, await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS }));
    await post(app, await registerBody(bob, shared, { inviteCode: "NOSUCH99", issuedAt: NOW_SECONDS }));

    const carol = await createTestWallet();
    const { json } = await post(app, await registerBody(carol, shared, { inviteCode: "ALICE001", issuedAt: NOW_SECONDS }));

    expect(json).toMatchObject({ referred: false });
  }, 30_000);

  it("moves a re-registered wallet to its new device and keeps its code and referrer", async () => {
    const db = await createTestDb();
    const app = setup(db);
    await post(app, await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS }));
    await post(app, await registerBody(bob, await createTestDevice(), { inviteCode: "ALICE001", issuedAt: NOW_SECONDS }));
    const reinstall = await createTestDevice();

    const { json } = await post(app, await registerBody(bob, reinstall, { issuedAt: NOW_SECONDS }));

    expect(json).toEqual({ address: bob.address, inviteCode: "BOB00002", referred: true });
    const { rows } = await db.query<{ device_id: string }>("SELECT device_id FROM wallets WHERE address = $1", [
      bob.address,
    ]);
    expect(rows[0]?.device_id).toBe(reinstall.id);
  });

  it("rejects a signature from another wallet", async () => {
    const body = await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS });

    const { status } = await post(setup(await createTestDb()), { ...body, owner: bob.jwk.n });

    expect(status).toBe(401);
  });

  it("rejects a device key that doesn't match the signed thumbprint", async () => {
    const body = await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS });
    const other = await createTestDevice();

    const { status } = await post(setup(await createTestDb()), { ...body, devicePublicKey: other.publicKey });

    expect(status).toBe(400);
  });

  it("rejects a stale message", async () => {
    const body = await registerBody(alice, await createTestDevice(), { issuedAt: NOW_SECONDS - 601 });

    const { status } = await post(setup(await createTestDb()), body);

    expect(status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    expect((await post(setup(await createTestDb()), { owner: 5 })).status).toBe(400);
  });

  it("rate-limits per client IP", async () => {
    const app = setup(await createTestDb());
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const response = await app.request("/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        body: "{}",
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
