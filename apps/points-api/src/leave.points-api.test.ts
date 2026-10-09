// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { Db } from "./db";
import { runSnapshot } from "./snapshot";
import { admitInstall, createTestDb } from "./test-db";
import {
  createTestDevice,
  createTestWallet,
  leaveBody,
  registerBody,
  type TestDevice,
  type TestWallet,
} from "./test-signers";

const NOW = new Date("2026-10-08T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

let alice: TestWallet;
let bob: TestWallet;
let carol: TestWallet;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([createTestWallet(), createTestWallet(), createTestWallet()]);
}, 90_000);

async function setup() {
  const db = await createTestDb();
  const codes = ["ALICE001", "BOB00002", "CAROL003"];
  const app = createApp({ db, now: () => NOW, newInviteCode: () => codes.shift()! });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const register = async (wallet: TestWallet, device: TestDevice, inviteCode?: string) =>
    post("/register", await registerBody(wallet, device, { inviteCode, issuedAt: NOW_SECONDS }));

  const devices = { alice: await createTestDevice(), bob: await createTestDevice() };
  await admitInstall(db, devices.alice);
  await register(alice, devices.alice);
  await admitInstall(db, devices.bob, "ALICE001");
  await register(bob, devices.bob, "ALICE001");
  await register(carol, devices.bob);
  return { db, devices, post };
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`, params);
  return Number(rows[0]!.n);
}

const balances = async () => ({ arAtomic: "100", aoAtomic: "0" });

describe("POST /leave", () => {
  it("deletes the wallet with its snapshots and points, and its device once unused", async () => {
    const { db, devices, post } = await setup();
    await runSnapshot(db, NOW, { readBalances: balances });

    expect((await post("/leave", await leaveBody(alice, NOW_SECONDS))).status).toBe(200);

    expect(await count(db, "wallets WHERE address = $1", [alice.address])).toBe(0);
    expect(await count(db, "snapshots WHERE address = $1", [alice.address])).toBe(0);
    expect(await count(db, "points WHERE address = $1", [alice.address])).toBe(0);
    expect(await count(db, "devices WHERE id = $1", [devices.alice.id])).toBe(0);
  });

  it("keeps a device another wallet still uses", async () => {
    const { db, devices, post } = await setup();

    await post("/leave", await leaveBody(bob, NOW_SECONDS));

    expect(await count(db, "devices WHERE id = $1", [devices.bob.id])).toBe(1);
  });

  it("stops the invite link: an invitee keeps its points but is no longer credited as invited", async () => {
    const { db, post } = await setup();
    await runSnapshot(db, NOW, { readBalances: balances });

    await post("/leave", await leaveBody(alice, NOW_SECONDS));

    const { rows } = await db.query<{ referred_by: string | null }>("SELECT referred_by FROM wallets WHERE address = $1", [
      bob.address,
    ]);
    expect(rows[0]?.referred_by).toBeNull();
    expect(await count(db, "points WHERE address = $1", [bob.address])).toBe(1);
  });

  it("succeeds again for a wallet that already left", async () => {
    const { post } = await setup();
    await post("/leave", await leaveBody(alice, NOW_SECONDS));

    expect((await post("/leave", await leaveBody(alice, NOW_SECONDS))).status).toBe(200);
  });

  it("rejects a signature for another address, a stale message and a malformed body", async () => {
    const { db, post } = await setup();

    // Bob signs a request naming Alice's address.
    expect((await post("/leave", await leaveBody(bob, NOW_SECONDS, alice.address))).status).toBe(401);
    expect((await post("/leave", await leaveBody(alice, NOW_SECONDS - 601))).status).toBe(401);
    expect((await post("/leave", { owner: 1 })).status).toBe(400);
    expect(await count(db, "wallets")).toBe(3);
  });

  it("doesn't break a snapshot when a wallet leaves while balances are being read", async () => {
    const { db, post } = await setup();
    const readBalances = async (address: string) => {
      if (address === carol.address) await post("/leave", await leaveBody(carol, NOW_SECONDS));
      return balances();
    };

    const summary = await runSnapshot(db, NOW, { readBalances, concurrency: 1 });

    expect(summary?.walletCount).toBe(3);
    expect(await count(db, "points")).toBe(2);
    expect(await count(db, "points WHERE address = $1", [carol.address])).toBe(0);
  });
});
