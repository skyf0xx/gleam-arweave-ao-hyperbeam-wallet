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
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
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
      return failBalance ? new Response("x", { status: 500 }) : new Response("1");
    }
    const { query } = JSON.parse(String(init?.body));
    const edges = (node: object) => ({ edges: [{ cursor: "c", node }] });
    if (query.includes("$ids")) {
      return Response.json({ data: { transactions: edges({ id: ASSET, tags: nft.map((name, i) => ({ name, value: values[i] })) }) } });
    }
    // Discovery's scans share one aliased query (`s0`, `s1`, `s2`).
    const scan = edges({ id: "m", recipient: ASSET, tags: [] });
    return Response.json({ data: { s0: scan, s1: scan, s2: scan } });
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

  it("rediscovers once the gateway or peer changes, inside the TTL", async () => {
    const fn = stubNetwork();
    const storage = createFakeStorage();
    const reads = new ReadsHandler(storage);
    await reads.getCollectibles({ address: ADDRESS });
    const calls = fn.mock.calls.length;

    await storage.set("local:networkSettings", { gatewayUrl: "https://ar-io.dev", peers: [], activePeerUrl: "https://push.forward.computer" });
    await reads.getCollectibles({ address: ADDRESS });

    expect(fn.mock.calls.length).toBeGreaterThan(calls);
  });

  it("keeps a collectible with a send still pending off a rediscovered list", async () => {
    stubNetwork();
    const storage = createFakeStorage();
    await storage.set(`local:activityLog:${ADDRESS}`, [
      { txId: "t", type: "send", status: "pending", address: "R".repeat(43), amount: null, tags: [], timestamp: 1, collectible: { id: ASSET } },
    ]);

    await expect(new ReadsHandler(storage).getCollectibles({ address: ADDRESS })).resolves.toEqual([]);
  });

  it("rediscovers rather than serve a cached collectible with a malformed field", async () => {
    const fn = stubNetwork();
    const storage = createFakeStorage();
    const reads = new ReadsHandler(storage);
    await reads.getCollectibles({ address: ADDRESS });
    const key = `local:collectibles:${ADDRESS}`;
    const cached = storage.store.get(key) as { collectibles: Array<Record<string, unknown>> };
    storage.store.set(key, { ...cached, collectibles: [{ ...cached.collectibles[0], videoUrl: 5 }] });
    const calls = fn.mock.calls.length;

    const list = await reads.getCollectibles({ address: ADDRESS });

    expect(fn.mock.calls.length).toBeGreaterThan(calls);
    expect(list[0]).not.toHaveProperty("videoUrl");
  });

  it("serves a cached Permaweb Name and rediscovers past a malformed one", async () => {
    const fn = stubNetwork();
    const storage = createFakeStorage();
    const reads = new ReadsHandler(storage);
    await reads.getCollectibles({ address: ADDRESS });
    const key = `local:collectibles:${ADDRESS}`;
    const cached = storage.store.get(key) as { collectibles: Array<Record<string, unknown>> };
    const name = { id: ASSET, name: "@zy", ticker: "NAME", permawebName: { label: "zy", target: ASSET, listed: true } };
    storage.store.set(key, { ...cached, collectibles: [name] });
    const calls = fn.mock.calls.length;
    await expect(reads.getCollectibles({ address: ADDRESS })).resolves.toEqual([name]);
    expect(fn.mock.calls.length).toBe(calls);

    storage.store.set(key, { ...cached, collectibles: [{ ...name, permawebName: { label: "zy", listed: "yes" } }] });
    await reads.getCollectibles({ address: ADDRESS });
    expect(fn.mock.calls.length).toBeGreaterThan(calls);
  });

  it("shares one discovery between concurrent calls", async () => {
    const fn = stubNetwork();
    const reads = new ReadsHandler(createFakeStorage());
    await Promise.all([reads.getCollectibles({ address: ADDRESS }), reads.getCollectibles({ address: ADDRESS })]);
    const balanceReads = fn.mock.calls.filter(([u]) => String(u).includes("/now/as/balance"));
    expect(balanceReads.length).toBeGreaterThan(0);
    // Hosts at the same slot are asked together, each once per discovery.
    expect(new Set(balanceReads.map(([u]) => String(u))).size).toBe(balanceReads.length);
  });
});
