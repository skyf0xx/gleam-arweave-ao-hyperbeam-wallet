import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  base64UrlToBytes,
  deriveAddress,
  generateJWK,
  verifyMessage,
  type BadgePort,
  type JWKInterface,
  type StoragePort,
} from "@gleam/core";
import {
  deviceKeyThumbprint,
  parseDeviceMessage,
  parseLeaveMessage,
  parseRegisterMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "../adapters/device-key";
import {
  POINTS_DEVICE_STATE_KEY,
  POINTS_MEMBERSHIPS_KEY,
  POINTS_PENDING_INVITE_KEY,
  POINTS_CLAIM_PENDING_KEY,
  POINTS_REVEAL_SEEN_KEY,
  POINTS_SEATS_SEEN_KEY,
  POINTS_SHARE_SEEN_KEY,
  PointsHandler,
  type PointsDeviceState,
} from "./points";

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

async function createDeviceKey(): Promise<DeviceKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey: DevicePublicJwk = { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
  return { id: await deviceKeyThumbprint(publicKey), publicKey, privateKey: pair.privateKey };
}

function createFakeBadge(): BadgePort & { dot: boolean | null; setDot: ReturnType<typeof vi.fn> } {
  const badge = {
    dot: null as boolean | null,
    setDot: vi.fn(async (visible: boolean) => {
      badge.dot = visible;
    }),
  };
  return badge;
}

const NOW = Date.UTC(2026, 9, 8, 12);
const HOUR = 3_600_000;

let wallet: { jwk: JWKInterface; address: string };

beforeAll(async () => {
  const jwk = await generateJWK();
  wallet = { jwk, address: await deriveAddress(jwk) };
}, 60_000);

async function setup(
  state: PointsDeviceState | null,
  status = 200,
  options: { responseBody?: unknown; extraStorage?: Record<string, unknown>; locked?: boolean } = {},
) {
  const storage = createFakeStorage({
    ...(state ? { [POINTS_DEVICE_STATE_KEY]: state } : {}),
    ...options.extraStorage,
  });
  const device = await createDeviceKey();
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(options.responseBody ?? {}), { status }),
  );
  const badge = createFakeBadge();
  const handler = new PointsHandler({
    storage,
    deviceKey: async () => device,
    apiUrl: "https://points.example",
    signingKey: async (walletId) => (walletId === "w1" && !options.locked ? wallet : null),
    badge,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
  });
  return { storage, device, fetchImpl, handler, badge };
}

describe("PointsHandler.heartbeatIfDue", () => {
  it("does nothing until a wallet has registered", async () => {
    const { handler, fetchImpl } = await setup(null);

    expect(await handler.heartbeatIfDue()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing within 20 hours of the last heartbeat", async () => {
    const { handler, fetchImpl } = await setup({ registered: true, lastHeartbeatAt: NOW - 19 * HOUR });

    expect(await handler.heartbeatIfDue()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a heartbeat the device key signed, then records the time", async () => {
    const { handler, fetchImpl, device, storage } = await setup({ registered: true, lastHeartbeatAt: NOW - 21 * HOUR });

    expect(await handler.heartbeatIfDue()).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.example/heartbeat");
    const body = JSON.parse(init!.body as string) as { deviceId: string; message: string; signature: string };
    expect(body.deviceId).toBe(device.id);
    expect(parseDeviceMessage("heartbeat", body.message)).toBe(NOW / 1000);
    expect(await verifyDeviceSignature(device.publicKey, body.message, body.signature)).toBe(true);
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual({ registered: true, lastHeartbeatAt: NOW });
  });

  it("marks the install unregistered when the server doesn't know the device", async () => {
    const { handler, storage } = await setup({ registered: true, lastHeartbeatAt: null }, 404);

    expect(await handler.heartbeatIfDue()).toBe(false);
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual({ registered: false, lastHeartbeatAt: null });
  });

  it("throws on a server error and leaves the state for the next check to retry", async () => {
    const state = { registered: true, lastHeartbeatAt: null };
    const { handler, storage } = await setup(state, 502);

    await expect(handler.heartbeatIfDue()).rejects.toThrow(/502/);
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual(state);
  });
});

describe("PointsHandler.join", () => {
  const joined = () => ({ address: wallet.address, inviteCode: "MYCODE22", referred: true });

  function sentBody(fetchImpl: Awaited<ReturnType<typeof setup>>["fetchImpl"]) {
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.example/register");
    return JSON.parse(init!.body as string) as {
      owner: string;
      message: string;
      signature: string;
      devicePublicKey: DevicePublicJwk;
    };
  }

  it("signs the register payload with the wallet key and the pending invite code", async () => {
    const { handler, fetchImpl, device } = await setup(null, 200, {
      responseBody: joined(),
      extraStorage: { [POINTS_PENDING_INVITE_KEY]: "FRIEND42" },
    });

    await handler.join({ walletId: "w1" });

    const body = sentBody(fetchImpl);
    expect(body.owner).toBe(wallet.jwk.n);
    expect(body.devicePublicKey).toEqual(device.publicKey);
    expect(parseRegisterMessage(body.message)).toEqual({
      deviceKeyThumbprint: device.id,
      inviteCode: "FRIEND42",
      issuedAt: NOW / 1000,
    });
    expect(
      await verifyMessage(
        wallet.jwk.n,
        new TextEncoder().encode(body.message).buffer as ArrayBuffer,
        base64UrlToBytes(body.signature).buffer,
      ),
    ).toBe(true);
  });

  it("stores the membership, turns on the heartbeat and clears the pending code and claim", async () => {
    const { handler, storage } = await setup(null, 200, {
      responseBody: joined(),
      extraStorage: { [POINTS_PENDING_INVITE_KEY]: "FRIEND42", [POINTS_CLAIM_PENDING_KEY]: { w1: true, w2: true } },
    });

    const membership = await handler.join({ walletId: "w1" });

    expect(membership).toEqual({ address: wallet.address, inviteCode: "MYCODE22", referred: true, joinedAt: NOW });
    expect(await handler.getMemberships()).toEqual({ w1: membership });
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual({ registered: true, lastHeartbeatAt: NOW });
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
    expect(await handler.getClaimPending()).toEqual(["w2"]);
  });

  it("prefers a typed invite code, normalized, over the pending one", async () => {
    const { handler, fetchImpl } = await setup(null, 200, {
      responseBody: joined(),
      extraStorage: { [POINTS_PENDING_INVITE_KEY]: "FRIEND42" },
    });

    await handler.join({ walletId: "w1", inviteCode: "  typed123 " });

    expect(parseRegisterMessage(sentBody(fetchImpl).message)?.inviteCode).toBe("TYPED123");
  });

  it("rejects a malformed typed code and a locked wallet without calling the server", async () => {
    const { handler, fetchImpl } = await setup(null);
    const locked = await setup(null, 200, { locked: true });

    await expect(handler.join({ walletId: "w1", inviteCode: "no!" })).rejects.toThrow(/isn't valid/);
    await expect(locked.handler.join({ walletId: "w1" })).rejects.toThrow(/Unlock/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(locked.fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces the server's error and stores nothing", async () => {
    const { handler, storage } = await setup(null, 401, { responseBody: { error: "Register message is stale." } });

    await expect(handler.join({ walletId: "w1" })).rejects.toThrow(/stale/);
    expect(storage.store.has(POINTS_MEMBERSHIPS_KEY)).toBe(false);
  });

  it("rejects a response for a different address", async () => {
    const { handler } = await setup(null, 200, { responseBody: { ...joined(), address: "someone-else" } });

    await expect(handler.join({ walletId: "w1" })).rejects.toThrow(/unexpected/);
  });
});

describe("PointsHandler.scores", () => {
  it("returns null before any wallet joins, without calling the server", async () => {
    const { handler, fetchImpl } = await setup(null);

    expect(await handler.scores()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a device-signed score read and returns the server's scores", async () => {
    const scores = { settledAt: "2026-10-08T00:05:00.000Z", wallets: [] };
    const { handler, fetchImpl, device } = await setup({ registered: true, lastHeartbeatAt: NOW }, 200, {
      responseBody: scores,
    });

    expect(await handler.scores()).toEqual(scores);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.example/me");
    const body = JSON.parse(init!.body as string) as { message: string; signature: string };
    expect(parseDeviceMessage("me", body.message)).toBe(NOW / 1000);
    expect(await verifyDeviceSignature(device.publicKey, body.message, body.signature)).toBe(true);
  });

  it("throws on a server error", async () => {
    const { handler } = await setup({ registered: true, lastHeartbeatAt: NOW }, 500);

    await expect(handler.scores()).rejects.toThrow(/500/);
  });
});

describe("PointsHandler.leave", () => {
  const member = { address: "x", inviteCode: "MYCODE22", referred: false, joinedAt: 1 };

  it("posts a leave payload the wallet signed for its own address", async () => {
    const { handler, fetchImpl } = await setup({ registered: true, lastHeartbeatAt: NOW }, 200, {
      responseBody: { ok: true },
      extraStorage: { [POINTS_MEMBERSHIPS_KEY]: { w1: member } },
    });

    await handler.leave({ walletId: "w1" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://points.example/leave");
    const body = JSON.parse(init!.body as string) as { owner: string; message: string; signature: string };
    expect(body.owner).toBe(wallet.jwk.n);
    expect(parseLeaveMessage(body.message)).toEqual({ address: wallet.address, issuedAt: NOW / 1000 });
    expect(
      await verifyMessage(
        wallet.jwk.n,
        new TextEncoder().encode(body.message).buffer as ArrayBuffer,
        base64UrlToBytes(body.signature).buffer,
      ),
    ).toBe(true);
  });

  it("stops heartbeats once the last member wallet leaves", async () => {
    const { handler, storage } = await setup({ registered: true, lastHeartbeatAt: NOW }, 200, {
      responseBody: { ok: true },
      extraStorage: { [POINTS_MEMBERSHIPS_KEY]: { w1: member } },
    });

    await handler.leave({ walletId: "w1" });

    expect(await handler.getMemberships()).toEqual({});
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual({ registered: false, lastHeartbeatAt: null });
  });

  it("keeps heartbeats on while another wallet is still a member", async () => {
    const state = { registered: true, lastHeartbeatAt: NOW };
    const { handler, storage } = await setup(state, 200, {
      responseBody: { ok: true },
      extraStorage: { [POINTS_MEMBERSHIPS_KEY]: { w1: member, w2: member } },
    });

    await handler.leave({ walletId: "w1" });

    expect(await handler.getMemberships()).toEqual({ w2: member });
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual(state);
  });

  it("keeps the membership when the server refuses, and needs the wallet unlocked", async () => {
    const { handler } = await setup({ registered: true, lastHeartbeatAt: NOW }, 401, {
      responseBody: { error: "Leave message is stale." },
      extraStorage: { [POINTS_MEMBERSHIPS_KEY]: { w1: member } },
    });
    const locked = await setup(null, 200, { locked: true });

    await expect(handler.leave({ walletId: "w1" })).rejects.toThrow(/stale/);
    expect(await handler.getMemberships()).toEqual({ w1: member });
    await expect(locked.handler.leave({ walletId: "w1" })).rejects.toThrow(/Unlock/);
  });
});

describe("PointsHandler.redeemInvite", () => {
  it("keeps a code that unlocked the install as the pending invite for the claim step", async () => {
    const storage = createFakeStorage();
    const handler = new PointsHandler({
      storage,
      deviceKey: createDeviceKey,
      apiUrl: "https://points.test",
      signingKey: async () => null,
      badge: createFakeBadge(),
      fetchImpl: (async () => new Response(JSON.stringify({ result: "ok" }))) as unknown as typeof fetch,
      now: () => NOW,
    });
    await handler.redeemInvite("gleamdrop7");
    expect(storage.store.get(POINTS_PENDING_INVITE_KEY)).toBe("GLEAMDROP7");
  });

  it("does not keep a code that was full", async () => {
    const storage = createFakeStorage();
    const handler = new PointsHandler({
      storage,
      deviceKey: createDeviceKey,
      apiUrl: "https://points.test",
      signingKey: async () => null,
      badge: createFakeBadge(),
      fetchImpl: (async () => new Response(JSON.stringify({ result: "full" }))) as unknown as typeof fetch,
      now: () => NOW,
    });
    await handler.redeemInvite("GLEAMDROP7");
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
  });
});

describe("PointsHandler.markUnlockedForVault", () => {
  function build(storage: ReturnType<typeof createFakeStorage>, fetchImpl: typeof fetch) {
    return new PointsHandler({
      storage,
      deviceKey: createDeviceKey,
      apiUrl: "https://points.test",
      signingKey: async () => null,
      badge: createFakeBadge(),
      fetchImpl,
      now: () => NOW,
    });
  }

  it("unlocks an install that has a vault and never asks the server again", async () => {
    const storage = createFakeStorage();
    const fetchImpl = vi.fn();
    const handler = build(storage, fetchImpl as unknown as typeof fetch);
    await handler.markUnlockedForVault();
    expect(await handler.getInviteUnlock()).toEqual({ code: "", result: "ok", at: NOW });
    await handler.redeemInvite("GLEAMDROP7");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("replaces a stored failure but keeps a redeemed unlock", async () => {
    const full = { code: "GLEAMDROP7", result: "full", at: 1 };
    const storage = createFakeStorage({ "local:points:inviteUnlock": full });
    const handler = build(storage, vi.fn() as unknown as typeof fetch);
    await handler.markUnlockedForVault();
    expect((await handler.getInviteUnlock())?.result).toBe("ok");

    const redeemed = { code: "GLEAMDROP7", result: "ok", at: 1 };
    const kept = createFakeStorage({ "local:points:inviteUnlock": redeemed });
    await build(kept, vi.fn() as unknown as typeof fetch).markUnlockedForVault();
    expect(kept.store.get("local:points:inviteUnlock")).toEqual(redeemed);
  });
});

describe("PointsHandler.pendingInvite", () => {
  function build(initial: Record<string, unknown>, fetchImpl: typeof fetch) {
    const storage = createFakeStorage(initial);
    const handler = new PointsHandler({
      storage,
      deviceKey: createDeviceKey,
      apiUrl: "https://points.test",
      signingKey: async () => null,
      badge: createFakeBadge(),
      fetchImpl,
      now: () => NOW,
    });
    return { storage, handler };
  }
  const kind = (value: unknown) => (async () => new Response(JSON.stringify({ kind: value }))) as unknown as typeof fetch;

  it("returns null when there is no pending code, without asking the server", async () => {
    const fetchImpl = vi.fn();
    const { handler } = build({}, fetchImpl as unknown as typeof fetch);
    expect(await handler.pendingInvite()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a member code", async () => {
    const { handler } = build({ [POINTS_PENDING_INVITE_KEY]: "FRIEND42" }, kind("member"));
    expect(await handler.pendingInvite()).toBe("FRIEND42");
  });

  it("forgets a drop code, which has no referrer", async () => {
    const { handler, storage } = build({ [POINTS_PENDING_INVITE_KEY]: "GLEAMDROP7" }, kind("drop"));
    expect(await handler.pendingInvite()).toBeNull();
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
  });

  it("keeps the code when the server can't say what kind it is", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { handler } = build({ [POINTS_PENDING_INVITE_KEY]: "FRIEND42" }, failing);
    expect(await handler.pendingInvite()).toBe("FRIEND42");
  });
});

describe("PointsHandler founding reveal seen", () => {
  it("records each wallet once and lists them", async () => {
    const storage = createFakeStorage();
    const handler = new PointsHandler({
      storage,
      deviceKey: createDeviceKey,
      apiUrl: "https://points.test",
      signingKey: async () => null,
      badge: createFakeBadge(),
      now: () => NOW,
    });
    expect(await handler.getRevealSeen()).toEqual([]);
    await handler.markRevealSeen({ walletId: "w1" });
    await handler.markRevealSeen({ walletId: "w2" });
    await handler.markRevealSeen({ walletId: "w1" });
    expect(await handler.getRevealSeen()).toEqual(["w1", "w2"]);
    expect(storage.store.get(POINTS_REVEAL_SEEN_KEY)).toEqual({ w1: true, w2: true });
  });
});

describe("PointsHandler claim pending", () => {
  it("records and clears each wallet's pending claim", async () => {
    const { handler, storage } = await setup(null);
    expect(await handler.getClaimPending()).toEqual([]);
    await handler.setClaimPending({ walletId: "w1", pending: true });
    await handler.setClaimPending({ walletId: "w2", pending: true });
    await handler.setClaimPending({ walletId: "w1", pending: false });
    expect(await handler.getClaimPending()).toEqual(["w2"]);
    expect(storage.store.get(POINTS_CLAIM_PENDING_KEY)).toEqual({ w2: true });
  });
});

describe("PointsHandler share prompts seen", () => {
  it("records each named prompt once per wallet", async () => {
    const { handler, storage } = await setup(null);

    expect(await handler.getShareSeen()).toEqual({});
    await handler.markShareSeen({ walletId: "w1", prompt: "lastSeat" });
    await handler.markShareSeen({ walletId: "w1", prompt: "lastSeat" });
    await handler.markShareSeen({ walletId: "w1", prompt: "joined" });
    await handler.markShareSeen({ walletId: "w2", prompt: "joined" });

    expect(await handler.getShareSeen()).toEqual({ w1: ["lastSeat", "joined"], w2: ["joined"] });
    expect(storage.store.get(POINTS_SHARE_SEEN_KEY)).toEqual({ w1: ["lastSeat", "joined"], w2: ["joined"] });
  });
});

describe("PointsHandler seat refill", () => {
  const member = { address: "addr-1", inviteCode: "MYCODE22", referred: false, joinedAt: 1 };
  const REGISTERED = { registered: true, lastHeartbeatAt: NOW };

  function meBody(seatsLeft: number | null) {
    return { settledAt: null, wallets: [{ address: "addr-1", seatsLeft }] };
  }

  async function seatsSetup(seatsLeft: number | null, seats?: Record<string, { seen: number; latest: number }>) {
    return setup(REGISTERED, 200, {
      responseBody: meBody(seatsLeft),
      extraStorage: { [POINTS_MEMBERSHIPS_KEY]: { w1: member }, ...(seats ? { [POINTS_SEATS_SEEN_KEY]: seats } : {}) },
    });
  }

  it("records the first count it sees without signalling", async () => {
    const { handler, storage, badge } = await seatsSetup(3);

    await handler.scores();

    expect(storage.store.get(POINTS_SEATS_SEEN_KEY)).toEqual({ w1: { seen: 3, latest: 3 } });
    expect(await handler.getSeatsSeen()).toEqual({ w1: 3 });
    expect(badge.dot).toBe(false);
  });

  it("shows the dot when seats rise above the last count seen, and keeps the seen count", async () => {
    const { handler, badge } = await seatsSetup(3, { w1: { seen: 2, latest: 2 } });

    await handler.checkSeats();

    expect(badge.dot).toBe(true);
    expect(await handler.getSeatsSeen()).toEqual({ w1: 2 });
  });

  it("clears the dot once the new count is marked seen", async () => {
    const { handler, badge } = await seatsSetup(3, { w1: { seen: 2, latest: 2 } });
    await handler.checkSeats();

    await handler.markSeatsSeen({ walletId: "w1", seats: 3 });

    expect(badge.dot).toBe(false);
    expect(await handler.getSeatsSeen()).toEqual({ w1: 3 });
  });

  it("lowers the seen count when a seat is used, so its return reads as new", async () => {
    const used = await seatsSetup(2, { w1: { seen: 3, latest: 3 } });
    await used.handler.checkSeats();
    expect(await used.handler.getSeatsSeen()).toEqual({ w1: 2 });
    expect(used.badge.dot).toBe(false);

    const back = await seatsSetup(3, { w1: { seen: 2, latest: 2 } });
    await back.handler.checkSeats();
    expect(back.badge.dot).toBe(true);
  });

  it("keeps the dot while another wallet still has a new seat", async () => {
    const { handler, badge } = await seatsSetup(3, {
      w1: { seen: 2, latest: 3 },
      w2: { seen: 1, latest: 2 },
    });

    await handler.markSeatsSeen({ walletId: "w1", seats: 3 });

    expect(badge.dot).toBe(true);
  });

  it("ignores wallets without a seat limit", async () => {
    const { handler, storage, badge } = await seatsSetup(null);

    await handler.checkSeats();

    expect(storage.store.get(POINTS_SEATS_SEEN_KEY)).toEqual({});
    expect(badge.dot).toBe(false);
  });

  it("does not ask the server before a wallet has joined", async () => {
    const { handler, fetchImpl, badge } = await setup(null);

    await handler.checkSeats();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(badge.setDot).not.toHaveBeenCalled();
  });

  it("forgets a wallet's seats and prompts when it leaves, and clears its dot", async () => {
    const { handler, storage, badge } = await setup(REGISTERED, 200, {
      responseBody: { ok: true },
      extraStorage: {
        [POINTS_MEMBERSHIPS_KEY]: { w1: member },
        [POINTS_SEATS_SEEN_KEY]: { w1: { seen: 2, latest: 3 } },
        [POINTS_SHARE_SEEN_KEY]: { w1: ["joined"] },
      },
    });

    await handler.leave({ walletId: "w1" });

    expect(storage.store.get(POINTS_SEATS_SEEN_KEY)).toEqual({});
    expect(storage.store.get(POINTS_SHARE_SEEN_KEY)).toEqual({});
    expect(badge.dot).toBe(false);
  });
});
