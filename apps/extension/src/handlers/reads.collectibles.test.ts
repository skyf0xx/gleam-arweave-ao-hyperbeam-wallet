import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ReadsHandler } from "./reads";

const ADDRESS = "W".repeat(43);
const ASSET = "A".repeat(43);

function createFakeStorage(): StoragePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
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

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function stubNetwork(failBalance = false) {
  const nft = ["device", "execution-device", "hint-ui-style", "denomination", "total-supply", "ticker", "name"];
  const values = ["process@1.0", "token@1.0", "non-fungible", "0", "1", "ASSET", "Pic"];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("~process@1.0")) {
      return failBalance ? new Response("x", { status: 500 }) : Response.json("1");
    }
    const { query } = JSON.parse(String(init?.body));
    const node = query.includes("$ids")
      ? { id: ASSET, tags: nft.map((name, i) => ({ name, value: values[i] })) }
      : { id: "m", recipient: ASSET, tags: [] };
    return Response.json({ data: { transactions: { edges: [{ cursor: "c", node }] } } });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("ReadsHandler: getCollectibles", () => {
  it("discovers, caches per wallet and serves the cache within the TTL", async () => {
    const fn = stubNetwork();
    const storage = createFakeStorage();
    const reads = new ReadsHandler(storage);

    const first = await reads.getCollectibles({ address: ADDRESS });
    expect(first.map((c) => c.id)).toEqual([ASSET]);
    expect(storage.store.has(`local:collectibles:${ADDRESS}`)).toBe(true);

    const calls = fn.mock.calls.length;
    await expect(reads.getCollectibles({ address: ADDRESS })).resolves.toEqual(first);
    expect(fn.mock.calls.length).toBe(calls);

    await reads.getCollectibles({ address: ADDRESS, refresh: true });
    expect(fn.mock.calls.length).toBeGreaterThan(calls);
  });

  it("serves the stale cache when rediscovery fails, and throws with no cache", async () => {
    const storage = createFakeStorage();
    const reads = new ReadsHandler(storage);
    stubNetwork();
    const first = await reads.getCollectibles({ address: ADDRESS });

    stubNetwork(true);
    await expect(reads.getCollectibles({ address: ADDRESS, refresh: true })).resolves.toEqual(first);

    await expect(new ReadsHandler(createFakeStorage()).getCollectibles({ address: ADDRESS })).rejects.toThrow();
  });

  it("shares one discovery between concurrent calls", async () => {
    const fn = stubNetwork();
    const reads = new ReadsHandler(createFakeStorage());
    await Promise.all([reads.getCollectibles({ address: ADDRESS }), reads.getCollectibles({ address: ADDRESS })]);
    const balanceReads = fn.mock.calls.filter(([u]) => String(u).includes("~process@1.0")).length;
    expect(balanceReads).toBe(1);
  });
});
