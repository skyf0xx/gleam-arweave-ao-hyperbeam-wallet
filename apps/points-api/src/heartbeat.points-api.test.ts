// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { admitInstall, createTestDb } from "./test-db";
import { createTestDevice, createTestWallet, deviceBody, registerBody, type TestWallet } from "./test-signers";

const REGISTERED_AT = new Date("2026-10-08T12:00:00Z");
const LATER = new Date("2026-10-09T12:00:00Z");
const LATER_SECONDS = LATER.getTime() / 1000;

let wallet: TestWallet;

beforeAll(async () => {
  wallet = await createTestWallet();
}, 60_000);

async function registeredSetup() {
  const db = await createTestDb();
  const device = await createTestDevice();
  let now = REGISTERED_AT;
  const app = createApp({ db, now: () => now });
  await admitInstall(db, device);
  await app.request("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await registerBody(wallet, device, { issuedAt: REGISTERED_AT.getTime() / 1000 })),
  });
  now = LATER;
  return { db, device, app };
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /heartbeat", () => {
  it("records the heartbeat time for a correctly signed request", async () => {
    const { db, device, app } = await registeredSetup();

    const response = await post(app, await deviceBody(device, "heartbeat", LATER_SECONDS));

    expect(response.status).toBe(200);
    const { rows } = await db.query<{ last_heartbeat_at: Date }>("SELECT last_heartbeat_at FROM devices");
    expect(rows[0]?.last_heartbeat_at.toISOString()).toBe(LATER.toISOString());
  });

  it("rejects another device's signature, a score-read payload and a stale payload", async () => {
    const { device, app } = await registeredSetup();
    const impostor = await createTestDevice();
    const forged = { ...(await deviceBody(impostor, "heartbeat", LATER_SECONDS)), deviceId: device.id };

    expect((await post(app, forged)).status).toBe(401);
    expect((await post(app, await deviceBody(device, "me", LATER_SECONDS))).status).toBe(400);
    expect((await post(app, await deviceBody(device, "heartbeat", LATER_SECONDS - 601))).status).toBe(401);
  });

  it("returns 404 for an unregistered device", async () => {
    const { app } = await registeredSetup();

    const response = await post(app, await deviceBody(await createTestDevice(), "heartbeat", LATER_SECONDS));

    expect(response.status).toBe(404);
  });

  it("limits each device to six heartbeats an hour", async () => {
    const { device, app } = await registeredSetup();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post(app, await deviceBody(device, "heartbeat", LATER_SECONDS))).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });
});
