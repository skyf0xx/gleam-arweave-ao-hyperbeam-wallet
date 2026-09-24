import { describe, expect, it, vi, afterEach } from "vitest";
import type { StoragePort } from "@gleam/core";

const alarmsCreate = vi.fn();
let onAlarmListener: ((alarm: { name: string }) => void) | undefined;
const alarmsAddListener = vi.fn((listener: (alarm: { name: string }) => void) => {
  onAlarmListener = listener;
});

vi.mock("wxt/browser", () => ({
  browser: {
    alarms: {
      create: alarmsCreate,
      onAlarm: { addListener: alarmsAddListener },
    },
  },
}));

const { ReadsHandler, ACTIVITY_PROMOTION_ALARM_NAME, registerActivityPromotionAlarm } = await import("./reads");

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

  it("resolves ticker/denomination/name for an unregistered watched token from its spawn tags", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
                      tags: [
                        { name: "ticker", value: "wUSDC" },
                        { name: "denomination", value: "6" },
                        { name: "name", value: "Wrapped USDC" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      // HyperBEAM compute path for the watched process (and the always-included AO token).
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    const unregistered = balances.find(
      (b) => b.processId === "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
    );
    expect(unregistered?.ticker).toBe("wUSDC");
    expect(unregistered?.denomination).toBe(6);
    expect(unregistered?.name).toBe("Wrapped USDC");
  });

  it("leaves an unregistered token's name null when its spawn tags carry no name", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
                      tags: [{ name: "ticker", value: "wUSDC" }],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    const unregistered = balances.find(
      (b) => b.processId === "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
    );
    expect(unregistered?.name).toBeNull();
  });

  it("gives the default AO token its registered name, not null", async () => {
    const storage = createFakeStorage();
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

    const ao = balances.find((b) => b.ticker === "AO");
    expect(ao?.name).toBe("AO");
  });

  it("does not use AO's denomination default for an unregistered token whose metadata resolves a different one", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
                      tags: [{ name: "denomination", value: "8" }],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      // Bare-quantity HyperBEAM response: getTokenBalance's own fallback is 12.
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    const unregistered = balances.find(
      (b) => b.processId === "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY",
    );
    expect(unregistered?.denomination).toBe(8);
  });

  it("marks an unregistered token unavailable (never AO's denomination default) when the metadata lookup fails", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["unknownProc"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      // Bare-quantity HyperBEAM response: getTokenBalance's own AO-specific
      // fallback denomination (12) must never surface for a non-AO token.
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    const unregistered = balances.find((b) => b.processId === "unknownProc");
    expect(unregistered?.ticker).toBe("unknownProc");
    // Denomination couldn't be confirmed, so `available: false` — not the
    // caller trusting `getTokenBalance`'s AO-specific 12 default to scale
    // this (or any) non-AO token's display.
    expect(unregistered?.available).toBe(false);
  });

  it("marks an unregistered token unavailable when its spawn tags resolve no denomination", async () => {
    const storage = createFakeStorage();
    const processId = "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY";
    await storage.set("local:watchedProcessIds:addr1", [processId]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [{ node: { id: processId, tags: [{ name: "ticker", value: "wUSDC" }] } }],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    const unregistered = balances.find((b) => b.processId === processId);
    expect(unregistered?.available).toBe(false);
  });

  it("caches resolved spawn-tag metadata by process id, hitting the gateway only once across repeated getTokenBalances calls", async () => {
    const storage = createFakeStorage();
    const processId = "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY";
    await storage.set("local:watchedProcessIds:addr1", [processId]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    let graphqlCalls = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        graphqlCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: processId,
                      tags: [
                        { name: "ticker", value: "wUSDC" },
                        { name: "denomination", value: "6" },
                        { name: "name", value: "Wrapped USDC" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.getTokenBalances({ address: "addr1" });
    await handler.getTokenBalances({ address: "addr1" });

    expect(graphqlCalls).toBe(1);

    const cached = await storage.get<{ ticker: string | null }>(`local:tokenMetadata:${processId}`);
    expect(cached?.ticker).toBe("wUSDC");
  });

  it("does not cache a failed metadata lookup, so a later call gets another chance to resolve it", async () => {
    const storage = createFakeStorage();
    const processId = "unknownProc";
    await storage.set("local:watchedProcessIds:addr1", [processId]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    let graphqlCalls = 0;
    let shouldFail = true;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        graphqlCalls += 1;
        if (shouldFail) return { ok: false, status: 500, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [{ node: { id: processId, tags: [{ name: "ticker", value: "RECOVERED" }] } }],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const first = await handler.getTokenBalances({ address: "addr1" });
    expect(first.find((b) => b.processId === processId)?.ticker).toBe(processId);
    expect(graphqlCalls).toBe(1);

    shouldFail = false;
    const second = await handler.getTokenBalances({ address: "addr1" });
    expect(second.find((b) => b.processId === processId)?.ticker).toBe("RECOVERED");
    expect(graphqlCalls).toBe(2);
  });
});

describe("ReadsHandler: tokenBalance", () => {
  it("throws a named error when no peer is configured", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: null,
    });
    const handler = new ReadsHandler(storage);
    await expect(handler.tokenBalance({ address: "addr1", id: "proc1" })).rejects.toThrow(
      /No HyperBEAM peer configured/,
    );
  });

  it("resolves a single process id's balance via the active peer", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => "123",
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const result = await handler.tokenBalance({ address: "addr1", id: "proc1" });

    expect(result).toBe("123");
    expect(typeof result).toBe("string");
  });
});

describe("ReadsHandler: userTokens", () => {
  it("returns registered tokens (AR-registry-backed name/ticker) in Wander's capitalized shape", async () => {
    const storage = createFakeStorage();
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
    const tokens = await handler.userTokens({ address: "addr1" });

    const ao = tokens.find((t) => t.Ticker === "AO");
    expect(ao).toBeDefined();
    expect(ao?.Name).toBe("AO");
    expect(typeof ao?.Denomination).toBe("string");
  });

  it("omits an unregistered token whose spawn-tag metadata never resolved a name", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["unknownProc"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const tokens = await handler.userTokens({ address: "addr1" });

    expect(tokens.find((t) => t.processId === "unknownProc")).toBeUndefined();
    // AO is still present — always registered/named regardless of the watch list.
    expect(tokens.find((t) => t.Ticker === "AO")).toBeDefined();
  });

  it("honors cursor/limit as a slice-based offset over the resolved list", async () => {
    const storage = createFakeStorage();
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
    const all = await handler.userTokens({ address: "addr1" });
    const limited = await handler.userTokens({ address: "addr1", options: { limit: 1 } });

    expect(limited).toHaveLength(1);
    expect(limited[0]).toEqual(all[0]);

    if (all.length > 1) {
      const nextPage = await handler.userTokens({
        address: "addr1",
        options: { cursor: "1", limit: 1 },
      });
      expect(nextPage[0]).toEqual(all[1]);
    }
  });
});

describe("ReadsHandler: getWatchedTokens / previewWatchedToken / addWatchedToken / removeWatchedToken", () => {
  it("returns an empty list when nothing has been watched yet", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("previewWatchedToken resolves the balance without storing the process id", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => "1000000" })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balance = await handler.previewWatchedToken({ address: "addr1", processId: "proc1" });

    expect(balance.quantity).toBe("1000000");
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("previewWatchedToken rejects an empty process id", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    await expect(handler.previewWatchedToken({ address: "addr1", processId: "  " })).rejects.toThrow(
      /Enter a process id/,
    );
  });

  it("adds a process id after validating its balance resolves, and returns the resolved balance", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: "proc1",
                      tags: [
                        { name: "Ticker", value: "wUSDC" },
                        { name: "Denomination", value: "6" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "1000000" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balance = await handler.addWatchedToken({ address: "addr1", processId: "proc1" });

    expect(balance.processId).toBe("proc1");
    expect(balance.quantity).toBe("1000000");
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual(["proc1"]);
  });

  it("rejects an empty process id without writing to storage", async () => {
    const storage = createFakeStorage();
    const handler = new ReadsHandler(storage);
    await expect(handler.addWatchedToken({ address: "addr1", processId: "  " })).rejects.toThrow(
      /Enter a process id/,
    );
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("throws a named error when no peer is configured, rather than silently adding an unresolved token", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: null,
    });
    const handler = new ReadsHandler(storage);
    await expect(handler.addWatchedToken({ address: "addr1", processId: "proc1" })).rejects.toThrow(
      /No HyperBEAM peer configured/,
    );
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("does not add a duplicate when the process id is already watched", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => "5" })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.addWatchedToken({ address: "addr1", processId: "proc1" });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual(["proc1"]);
  });

  it("is a no-op for the default AO process id (already always shown, never stored in the watch list)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => "5" })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.addWatchedToken({ address: "addr1", processId: "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc" });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("removes a watched process id", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1", "proc2"]);

    const handler = new ReadsHandler(storage);
    await handler.removeWatchedToken({ address: "addr1", processId: "proc1" });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual(["proc2"]);
  });

  it("is a no-op when removing a process id that isn't watched", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);

    const handler = new ReadsHandler(storage);
    await handler.removeWatchedToken({ address: "addr1", processId: "not-watched" });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual(["proc1"]);
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

describe("ReadsHandler: promotePendingActivity", () => {
  it("promotes a locally-pending entry to confirmed once the gateway indexes it", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "tx-pending", type: "send", status: "pending", address: "addr2", amount: "1", tags: [], timestamp: 500 },
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          transactions: {
            edges: [
              {
                cursor: "tx-pending",
                node: {
                  id: "tx-pending",
                  owner: { address: "addr1" },
                  recipient: "addr2",
                  quantity: { winston: "1" },
                  tags: [],
                  block: { timestamp: 500 },
                },
              },
            ],
          },
        },
      }),
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    const updatedLog = await storage.get<Array<{ txId: string; status: string }>>("local:activityLog:addr1");
    expect(updatedLog?.find((e) => e.txId === "tx-pending")?.status).toBe("confirmed");
  });

  it("leaves a still-genuinely-pending entry untouched when the gateway hasn't indexed it yet", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "tx-still-pending", type: "send", status: "pending", address: "addr2", amount: "1", tags: [], timestamp: 500 },
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { transactions: { edges: [] } } }),
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    const updatedLog = await storage.get<Array<{ txId: string; status: string }>>("local:activityLog:addr1");
    expect(updatedLog?.find((e) => e.txId === "tx-still-pending")?.status).toBe("pending");
  });

  it("settles a pending AO send as failed from the CU's Transfer-Error, even once the gateway indexes it", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "ao-msg", type: "send", status: "pending", address: "addr2", amount: "5", tags: [], timestamp: 500, token: "ao-process" },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/result/ao-msg?process-id=ao-process")) {
        return new Response(
          JSON.stringify({
            Messages: [{ Tags: [{ name: "Action", value: "Transfer-Error" }, { name: "Error", value: "Insufficient Balance!" }] }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            transactions: {
              edges: [
                {
                  cursor: "ao-msg",
                  node: { id: "ao-msg", owner: { address: "addr1" }, recipient: "", quantity: { winston: "0" }, tags: [], block: { timestamp: 500 } },
                },
              ],
            },
          },
        }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    const updatedLog = await storage.get<Array<{ txId: string; status: string; error?: string | null }>>(
      "local:activityLog:addr1",
    );
    expect(updatedLog?.find((e) => e.txId === "ao-msg")?.status).toBe("failed");
    expect(updatedLog?.find((e) => e.txId === "ao-msg")?.error).toBe("Insufficient Balance!");
    const page = await handler.getActivity({ address: "addr1" });
    expect(page.entries.find((e) => e.txId === "ao-msg")?.status).toBe("failed");
    expect(page.entries.find((e) => e.txId === "ao-msg")?.error).toBe("Insufficient Balance!");
  });

  it("settles a pending AO send as confirmed once the CU has evaluated it without error", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "ao-msg", type: "send", status: "pending", address: "addr2", amount: "5", tags: [], timestamp: 500, token: "ao-process" },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/result/")
        ? new Response(JSON.stringify({ Messages: [{ Tags: [{ name: "Action", value: "Debit-Notice" }] }] }))
        : new Response(JSON.stringify({ data: { transactions: { edges: [] } } })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    const updatedLog = await storage.get<Array<{ txId: string; status: string }>>("local:activityLog:addr1");
    expect(updatedLog?.find((e) => e.txId === "ao-msg")?.status).toBe("confirmed");
  });

  it("leaves a pending AO send pending while the CU hasn't evaluated it", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "ao-msg", type: "send", status: "pending", address: "addr2", amount: "5", tags: [], timestamp: 500, token: "ao-process" },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/result/")
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify({ data: { transactions: { edges: [] } } })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    const updatedLog = await storage.get<Array<{ txId: string; status: string }>>("local:activityLog:addr1");
    expect(updatedLog?.find((e) => e.txId === "ao-msg")?.status).toBe("pending");
  });

  it("does nothing (no network call) when the address has no pending entries", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activityLog:addr1", [
      { txId: "tx-1", type: "send", status: "confirmed", address: "addr2", amount: "1", tags: [], timestamp: 500 },
    ]);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    await handler.promotePendingActivity("addr1");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("registerActivityPromotionAlarm", () => {
  it("creates the named alarm and advances a pending entry to confirmed when it fires", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activityLog:addr1", [
      { txId: "tx-pending", type: "send", status: "pending", address: "addr2", amount: "1", tags: [], timestamp: 500 },
    ]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          transactions: {
            edges: [
              {
                cursor: "tx-pending",
                node: {
                  id: "tx-pending",
                  owner: { address: "addr1" },
                  recipient: "addr2",
                  quantity: { winston: "1" },
                  tags: [],
                  block: { timestamp: 500 },
                },
              },
            ],
          },
        },
      }),
    })) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    registerActivityPromotionAlarm(handler);

    expect(alarmsCreate).toHaveBeenCalledWith(
      ACTIVITY_PROMOTION_ALARM_NAME,
      expect.objectContaining({ periodInMinutes: expect.any(Number) }),
    );

    onAlarmListener?.({ name: ACTIVITY_PROMOTION_ALARM_NAME });
    await vi.waitFor(async () => {
      const updatedLog = await storage.get<Array<{ txId: string; status: string }>>("local:activityLog:addr1");
      expect(updatedLog?.find((e) => e.txId === "tx-pending")?.status).toBe("confirmed");
    });
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
