// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { runSnapshot } from "./snapshot";
import { createTestDb } from "./test-db";
import {
  createTestDevice,
  createTestWallet,
  deviceBody,
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
  const devices = { alice: await createTestDevice(), bob: await createTestDevice() };

  const register = async (wallet: TestWallet, device: TestDevice, inviteCode?: string) =>
    app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await registerBody(wallet, device, { inviteCode, issuedAt: NOW_SECONDS })),
    });
  await register(alice, devices.alice);
  await register(bob, devices.bob, "ALICE001");
  await register(carol, devices.bob);

  const postMe = async (body: unknown) => {
    const response = await app.request("/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  const me = async (device: TestDevice) => postMe(await deviceBody(device, "me", NOW_SECONDS));
  return { db, devices, me, postMe };
}

describe("POST /me", () => {
  it("lists the device's wallets with nothing credited before the first snapshot", async () => {
    const { devices, me } = await setup();

    const { status, json } = await me(devices.bob);

    expect(status).toBe(200);
    expect(json.settledAt).toBeNull();
    expect(json.wallets).toHaveLength(2);
    expect(json.wallets).toEqual(
      expect.arrayContaining([
        {
          address: bob.address,
          inviteCode: "BOB00002",
          referred: true,
          refereeCount: 0,
          totalAtomic: "0",
          lastDay: null,
          topPercent: null,
          foundingNumber: 2,
          originalFounder: false,
          seatsLeft: 3,
        },
        {
          address: carol.address,
          inviteCode: "CAROL003",
          referred: false,
          refereeCount: 0,
          totalAtomic: "0",
          lastDay: null,
          topPercent: null,
          foundingNumber: 3,
          originalFounder: false,
          seatsLeft: 3,
        },
      ]),
    );
  });

  it("returns totals, the last day's breakdown, referee count and rank after snapshots", async () => {
    const { db, devices, me } = await setup();
    const balances: Record<string, { arAtomic: string; aoAtomic: string }> = {
      [alice.address]: { arAtomic: "1000", aoAtomic: "0" },
      [bob.address]: { arAtomic: "100", aoAtomic: "0" },
      [carol.address]: { arAtomic: "0", aoAtomic: "10" },
    };
    const readBalances = async (address: string) => balances[address]!;
    await runSnapshot(db, NOW, { readBalances });
    await runSnapshot(db, new Date(NOW.getTime() + 86_400_000 - 3_600_000 * 11), { readBalances });

    const alicesView = (await me(devices.alice)).json;
    const bobsView = (await me(devices.bob)).json;

    expect(alicesView.settledAt).toBe("2026-10-09T01:00:00.000Z");
    expect(alicesView.wallets[0]).toMatchObject({
      refereeCount: 1,
      totalAtomic: "2020",
      lastDay: { holdingAtomic: "1000", refereeBonusAtomic: "0", founderBonusAtomic: "0", referrerBonusAtomic: "10" },
      topPercent: 34,
    });
    const byAddress = Object.fromEntries(
      bobsView.wallets.map((w: { address: string; totalAtomic: string; topPercent: number }) => [
        w.address,
        [w.totalAtomic, w.topPercent],
      ]),
    );
    expect(byAddress).toEqual({ [bob.address]: ["220", 67], [carol.address]: ["20", 100] });
  });

  it("reports the founder flag and counts the founder bonus in the total and last day", async () => {
    const { db, devices, me } = await setup();
    await db.query("UPDATE wallets SET original_founder = true WHERE address = $1", [alice.address]);
    const balances: Record<string, { arAtomic: string; aoAtomic: string }> = {
      [alice.address]: { arAtomic: "1000", aoAtomic: "0" },
      [bob.address]: { arAtomic: "0", aoAtomic: "0" },
      [carol.address]: { arAtomic: "0", aoAtomic: "0" },
    };

    await runSnapshot(db, NOW, { readBalances: async (address) => balances[address]! });

    const wallet = (await me(devices.alice)).json.wallets[0];
    expect(wallet).toMatchObject({
      originalFounder: true,
      totalAtomic: "1100",
      lastDay: { holdingAtomic: "1000", refereeBonusAtomic: "0", founderBonusAtomic: "100", referrerBonusAtomic: "0" },
    });
    expect((await me(devices.bob)).json.wallets[0].originalFounder).toBe(false);
  });

  it("refuses a heartbeat payload and another device's signature", async () => {
    const { devices, postMe } = await setup();
    const impostor = await createTestDevice();
    const forged = { ...(await deviceBody(impostor, "me", NOW_SECONDS)), deviceId: devices.alice.id };

    expect((await postMe(await deviceBody(devices.alice, "heartbeat", NOW_SECONDS))).status).toBe(400);
    expect((await postMe(forged)).status).toBe(401);
  });
});
