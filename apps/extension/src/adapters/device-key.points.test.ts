import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { deviceKeyThumbprint } from "@gleam/core/src/points/index.ts";
import { loadOrCreateDeviceKey, resetDeviceKeyCacheForTests } from "./device-key";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDeviceKeyCacheForTests();
});

describe("loadOrCreateDeviceKey", () => {
  it("creates a P-256 key whose id is its thumbprint, with a non-extractable private key", async () => {
    const key = await loadOrCreateDeviceKey();

    expect(key.id).toBe(await deviceKeyThumbprint(key.publicKey));
    expect(key.privateKey.extractable).toBe(false);
    expect(key.privateKey.algorithm).toMatchObject({ name: "ECDSA", namedCurve: "P-256" });
  });

  it("returns the stored key after the in-memory cache is gone, as after a worker restart", async () => {
    const first = await loadOrCreateDeviceKey();
    resetDeviceKeyCacheForTests();

    expect((await loadOrCreateDeviceKey()).id).toBe(first.id);
  });

  it("creates only one key for concurrent first calls", async () => {
    const [a, b] = await Promise.all([loadOrCreateDeviceKey(), loadOrCreateDeviceKey()]);

    expect(a.id).toBe(b.id);
  });
});
