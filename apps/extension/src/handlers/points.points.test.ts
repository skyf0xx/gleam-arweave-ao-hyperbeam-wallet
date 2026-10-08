import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import {
  deviceKeyThumbprint,
  parseDeviceMessage,
  verifyDeviceSignature,
  type DevicePublicJwk,
} from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "../adapters/device-key";
import { POINTS_DEVICE_STATE_KEY, PointsHandler, type PointsDeviceState } from "./points";

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

async function setup(state: PointsDeviceState | null, status = 200) {
  const storage = createFakeStorage(state ? { [POINTS_DEVICE_STATE_KEY]: state } : {});
  const device = await createDeviceKey();
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response("{}", { status }),
  );
  const handler = new PointsHandler({
    storage,
    deviceKey: async () => device,
    apiUrl: "https://points.example",
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
