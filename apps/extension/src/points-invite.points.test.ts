import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import {
  deviceKeyThumbprint,
  parseRedeemMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "./adapters/device-key";
import {
  POINTS_INVITE_UNLOCK_KEY,
  POINTS_MEMBERSHIPS_KEY,
  POINTS_PENDING_INVITE_KEY,
  PointsHandler,
} from "./handlers/points";
import { SITE_ORIGIN, acceptSiteInvite } from "./points-invite";

vi.mock("wxt/browser", () => ({ browser: {} }));

function createFakeStorage(initial: Record<string, unknown> = {}): StoragePort & { store: Map<string, unknown> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

const INVITE = { type: "gleam-points:invite", code: "FRIEND42" };
const NOW = Date.UTC(2026, 9, 8, 12);

let device: DeviceKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
  device = { id: await deviceKeyThumbprint(publicKey), publicKey, privateKey: pair.privateKey };
});

function setup(initial: Record<string, unknown> = {}, reply: () => Response | Promise<Response> = () => json({ result: "ok" })) {
  const storage = createFakeStorage(initial);
  const fetchImpl = vi.fn<typeof fetch>(async () => reply());
  const points = new PointsHandler({
    storage,
    deviceKey: async () => device,
    apiUrl: "https://points.test",
    signingKey: async () => null,
    fetchImpl,
    now: () => NOW,
  });
  return { storage, fetchImpl, points };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("acceptSiteInvite", () => {
  it.each(["ok", "full", "unknown"] as const)("redeems the code and replies %s", async (result) => {
    const { storage, points } = setup({}, () => json({ result }));

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: result });
    expect(storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("FRIEND42");
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toEqual({ code: "FRIEND42", result, at: NOW });
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a rate limit", () => json({ error: "slow down" }, 429)],
    ["a server error", () => json({ error: "boom" }, 503)],
  ])("stores offline after %s", async (_label, reply) => {
    const { storage, points } = setup({}, reply);

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "offline" });
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toEqual({ code: "FRIEND42", result: "offline", at: NOW });
    expect(storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("FRIEND42");
  });

  it("signs the redeem message with the device key", async () => {
    const { storage, fetchImpl, points } = setup();

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.test/invite/redeem");
    const body = JSON.parse(String(init?.body)) as {
      code: string;
      message: string;
      signature: string;
      devicePublicKey: DevicePublicJwk;
    };
    expect(body.code).toBe("FRIEND42");
    expect(body.devicePublicKey).toEqual(device.publicKey);
    expect(parseRedeemMessage(body.message)).toEqual({ code: "FRIEND42", issuedAt: Math.floor(NOW / 1000) });
    expect(await verifyDeviceSignature(body.devicePublicKey, body.message, body.signature)).toBe(true);
  });

  it("doesn't redeem again once unlocked", async () => {
    const { storage, fetchImpl, points } = setup();

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);
    const again = await acceptSiteInvite({ ...INVITE, code: "OTHER99" }, SITE_ORIGIN, storage, points);

    expect(again).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(storage.store.get(POINTS_INVITE_UNLOCK_KEY)).toMatchObject({ code: "FRIEND42", result: "ok" });
  });

  it("tries again after an offline result", async () => {
    let calls = 0;
    const { storage, fetchImpl, points } = setup({}, () => (++calls === 1 ? json({}, 503) : json({ result: "ok" })));

    await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points);
    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips redemption on an install that already has a wallet in", async () => {
    const { storage, fetchImpl, points } = setup({ [POINTS_MEMBERSHIPS_KEY]: { w1: {} } });

    expect(await acceptSiteInvite(INVITE, SITE_ORIGIN, storage, points)).toEqual({ ok: true, redeem: "ok" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
    expect(storage.store.has(POINTS_INVITE_UNLOCK_KEY)).toBe(false);
  });

  it("ignores any other origin", async () => {
    const { storage, fetchImpl, points } = setup();

    expect(await acceptSiteInvite(INVITE, "https://evil.example", storage, points)).toEqual({ ok: false });
    expect(await acceptSiteInvite(INVITE, undefined, storage, points)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["another type", { type: "other", code: "FRIEND42" }],
    ["a lowercase code", { type: "gleam-points:invite", code: "friend42" }],
    ["a non-string code", { type: "gleam-points:invite", code: 42 }],
    ["no body", null],
  ])("rejects %s", async (_label, message) => {
    const { storage, fetchImpl, points } = setup();

    expect(await acceptSiteInvite(message, SITE_ORIGIN, storage, points)).toEqual({ ok: false });
    expect(storage.store.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
