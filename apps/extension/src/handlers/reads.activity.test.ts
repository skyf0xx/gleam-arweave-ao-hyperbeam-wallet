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
  it("throws a named error when no peer is configured (the default AO token is always watched)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: null,
    });
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

    // "proc1" (explicitly watched) plus the default AO token process,
    // which getTokenBalances always includes regardless of the watch list.
    expect(balances).toHaveLength(2);
    const proc1Balance = balances.find((b) => b.processId === "proc1");
    expect(proc1Balance?.quantity).toBe("42");
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

describe("ReadsHandler: getPortfolioHistory", () => {
  it("throws a named error for an unrecognized range", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    await expect(
      handler.getPortfolioHistory({ range: "3D" as never }),
    ).rejects.toThrow(/Unrecognized portfolio history range/);
  });

  it("reports an empty series with no active wallet, rather than throwing or fabricating data", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    const history = await handler.getPortfolioHistory({ range: "7D" });
    expect(history).toEqual({
      range: "7D",
      series: [],
      currentUsdValue: 0,
      usdChange: 0,
      periodLabel: "Last 7 days",
    });
  });

  it("prices the active wallet's current AR balance across the fetched CoinGecko series", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activeWalletId", "w1");

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("wallet/addr1/balance")) {
        return { ok: true, status: 200, text: async () => "2000000000000" }; // 2 AR
      }
      if (url.includes("market_chart")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            prices: [
              [1000, 10],
              [2000, 20],
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const history = await handler.getPortfolioHistory({ range: "7D" });

    expect(history.range).toBe("7D");
    expect(history.periodLabel).toBe("Last 7 days");
    expect(history.series).toEqual([
      { timestamp: 1000, usdValue: 20 },
      { timestamp: 2000, usdValue: 40 },
    ]);
    expect(history.currentUsdValue).toBe(40);
    expect(history.usdChange).toBeCloseTo(1); // doubled: (40 - 20) / 20
  });

  it("falls back to an empty series (not a thrown error) when both price sources fail", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activeWalletId", "w1");

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("wallet/addr1/balance")) {
        return { ok: true, status: 200, text: async () => "1000000000000" };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const history = await handler.getPortfolioHistory({ range: "1M" });

    expect(history.series).toEqual([]);
    expect(history.currentUsdValue).toBe(0);
    expect(history.usdChange).toBe(0);
  });
});

describe("ReadsHandler: getConnectedApps", () => {
  it("returns an empty array (stub — Grants aren't implemented yet)", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    const grants = await handler.getConnectedApps();
    expect(grants).toEqual([]);
  });
});

describe("ReadsHandler: getNetworkSettings", () => {
  it("defaults to arweave.net with the default HyperBEAM peer when nothing is stored", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    expect(await handler.getNetworkSettings()).toEqual({
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://state.forward.computer", enabled: true }],
      activePeerUrl: "https://state.forward.computer",
    });
  });

  it("reflects previously stored network settings", async () => {
    const storage = createFakeStorage();
    const settings = {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    };
    await storage.set("local:networkSettings", settings);

    const handler = new ReadsHandler(storage);
    expect(await handler.getNetworkSettings()).toEqual(settings);
  });

  it("drops a malformed stored record back to the default (untrusted storage)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", { gatewayUrl: 12345 });
    const handler = new ReadsHandler(storage);
    expect(await handler.getNetworkSettings()).toEqual({
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://state.forward.computer", enabled: true }],
      activePeerUrl: "https://state.forward.computer",
    });
  });
});
