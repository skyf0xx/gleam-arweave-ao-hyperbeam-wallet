import { describe, expect, it, vi, afterEach } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ReadsHandler } from "./reads";

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
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
  vi.restoreAllMocks();
});

describe("ReadsHandler: getBalance", () => {
  it("reads the AR balance as a Winston string via the configured gateway", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "555000000000",
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(createFakeStorage());
    const balance = await handler.getBalance({ address: "addr1" });

    expect(balance).toBe("555000000000");
    expect(typeof balance).toBe("string");
  });

  it("defaults to arweave.net when no network settings are stored", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "0",
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(createFakeStorage());
    await handler.getBalance({ address: "addr1" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://arweave.net/wallet/addr1/balance"),
    );
  });
});

describe("ReadsHandler: getTokenBalances", () => {
  it("returns an empty array when no processIds are watched", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    const balances = await handler.getTokenBalances({ address: "addr1" });
    expect(balances).toEqual([]);
  });

  it("throws a named error when watching processIds but no peer is configured", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);
    const handler = new ReadsHandler(storage);

    await expect(handler.getTokenBalances({ address: "addr1" })).rejects.toThrow(
      /No HyperBEAM peer configured/,
    );
  });

  it("reads token balances from the active peer when configured", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => "42",
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    expect(balances).toHaveLength(1);
    expect(balances[0]?.quantity).toBe("42");
    expect(balances[0]?.processId).toBe("proc1");
  });
});

describe("ReadsHandler: getActivity", () => {
  it("merges the local activity log with the gateway query result", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "local-1", type: "send", status: "pending", address: "addr2", amount: "1", tags: [], timestamp: 500 },
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          transactions: {
            edges: [
              {
                cursor: "gw-1",
                node: {
                  id: "gw-1",
                  owner: { address: "addr1" },
                  recipient: "addr3",
                  quantity: { winston: "2" },
                  tags: [],
                  block: { timestamp: 1 },
                },
              },
            ],
          },
        },
      }),
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const page = await handler.getActivity({ address: "addr1" });

    expect(page.entries.map((e) => e.txId).sort()).toEqual(["gw-1", "local-1"]);
  });
});

describe("ReadsHandler: getConnectedApps", () => {
  it("returns an empty array (stub — Grants aren't implemented yet)", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    const grants = await handler.getConnectedApps();
    expect(grants).toEqual([]);
  });
});
