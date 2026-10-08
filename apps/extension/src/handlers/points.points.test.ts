import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  base64UrlToBytes,
  deriveAddress,
  generateJWK,
  verifyMessage,
  type JWKInterface,
  type StoragePort,
} from "@gleam/core";
import {
  deviceKeyThumbprint,
  parseDeviceMessage,
  parseRegisterMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "../adapters/device-key";
import {
  POINTS_DEVICE_STATE_KEY,
  POINTS_MEMBERSHIPS_KEY,
  POINTS_PENDING_INVITE_KEY,
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
  const handler = new PointsHandler({
    storage,
    deviceKey: async () => device,
    apiUrl: "https://points.example",
    signingKey: async (walletId) => (walletId === "w1" && !options.locked ? wallet : null),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
  });
  return { storage, device, fetchImpl, handler };
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

  it("stores the membership, turns on the heartbeat and clears the pending code", async () => {
    const { handler, storage } = await setup(null, 200, {
      responseBody: joined(),
      extraStorage: { [POINTS_PENDING_INVITE_KEY]: "FRIEND42" },
    });

    const membership = await handler.join({ walletId: "w1" });

    expect(membership).toEqual({ address: wallet.address, inviteCode: "MYCODE22", referred: true, joinedAt: NOW });
    expect(await handler.getMemberships()).toEqual({ w1: membership });
    expect(storage.store.get(POINTS_DEVICE_STATE_KEY)).toEqual({ registered: true, lastHeartbeatAt: NOW });
    expect(storage.store.has(POINTS_PENDING_INVITE_KEY)).toBe(false);
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
