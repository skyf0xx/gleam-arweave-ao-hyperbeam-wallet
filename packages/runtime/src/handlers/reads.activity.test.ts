import { describe, expect, it, vi, afterEach } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ReadsHandler, ACTIVITY_PROMOTION_ALARM_NAME, registerActivityPromotionAlarm } from "./reads";

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
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

const FODDER = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
const LEGACY = "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10";
const AO = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const PEER = "https://hyperbeam.example.com";
const noDiscovery = async () => [];

const FODDER_TAGS = [
  { name: "device", value: "process@1.0" },
  { name: "execution-device", value: "token@1.0" },
  { name: "scheduler-device", value: "arweave-scheduler@1.0" },
  { name: "hint-ui-style", value: "fungible" },
  { name: "ticker", value: "FODDER" },
  { name: "name", value: "FODDER" },
  { name: "denomination", value: "12" },
];
const LEGACY_TAGS = [
  { name: "Ticker", value: "wAR" },
  { name: "Denomination", value: "12" },
];

function graphqlNodes(nodes: Array<{ id: string; tags: Array<{ name: string; value: string }> }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { transactions: { edges: nodes.map((node) => ({ cursor: node.id, node })) } } }),
  };
}

async function peerSettings(storage: StoragePort, activePeerUrl: string | null = PEER) {
  await storage.set("local:networkSettings", {
    gatewayUrl: "https://arweave.net",
    peers: activePeerUrl ? [{ url: activePeerUrl, enabled: true }] : [],
    activePeerUrl,
  });
}

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
  it("reads AO through the CU dry-run when no peer is configured", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage, null);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("cu.ao-testnet.xyz/dry-run")
        ? { ok: true, status: 200, json: async () => ({ Messages: [{ Data: "7", Tags: [] }] }) }
        : { ok: false, status: 500, json: async () => ({}) },
    ) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, noDiscovery).getTokenBalances({ address: "addr1" });

    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({ processId: AO, ticker: "AO", quantity: "7", source: "default" });
    expect(balances[0]?.available).not.toBe(false);
  });

  it("reads a legacy token's balance from the active peer when configured", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", [LEGACY]);
    await peerSettings(storage);

    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: LEGACY, tags: LEGACY_TAGS }]) : { ok: true, status: 200, json: async () => "42" },
    ) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, noDiscovery).getTokenBalances({ address: "addr1" });

    // The watched token plus the default AO token, which is always listed.
    expect(balances).toHaveLength(2);
    expect(balances.find((b) => b.processId === LEGACY)).toMatchObject({ quantity: "42", ticker: "wAR", source: "watched" });
    expect(globalThis.fetch).toHaveBeenCalledWith(`${PEER}/${LEGACY}~process@1.0/compute/balances/addr1`);
  });

  it("gives a watched token its logo as a gateway URL, and none for a malformed logo tag", async () => {
    const LOGO = "L".repeat(43);
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", [LEGACY, FODDER]);
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/graphql")) {
        const ids = JSON.stringify(init?.body ?? "");
        return graphqlNodes(
          ids.includes(LEGACY)
            ? [{ id: LEGACY, tags: [...LEGACY_TAGS, { name: "Logo", value: LOGO }] }]
            : [{ id: FODDER, tags: [...FODDER_TAGS, { name: "logo", value: "https://evil.example/x.png" }] }],
        );
      }
      return { ok: true, status: 200, json: async () => "1" };
    }) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, noDiscovery).getTokenBalances({ address: "addr1" });

    expect(balances.find((b) => b.processId === LEGACY)?.logoUrl).toBe(`https://arweave.net/${LOGO}`);
    expect(balances.find((b) => b.processId === FODDER)).not.toHaveProperty("logoUrl");
  });

  it("reads an arweave-scheduler token from the gateway's HyperBEAM, not the legacy peer", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", [FODDER]);
    await peerSettings(storage);

    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/graphql")) return graphqlNodes([{ id: FODDER, tags: FODDER_TAGS }]);
      if (new URL(url).origin === new URL(PEER).origin && url.includes(FODDER)) return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => "1000000000000" };
    }) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, noDiscovery).getTokenBalances({ address: "addr1" });

    expect(balances.find((b) => b.processId === FODDER)).toMatchObject({ ticker: "FODDER", denomination: 12, quantity: "1000000000000" });
    expect(calls).toContain(`https://arweave.net/${FODDER}~process@1.0/compute/balances/addr1`);
    expect(calls.some((url) => new URL(url).origin === new URL(PEER).origin && url.includes(FODDER))).toBe(false);
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

  it("one token's failed HyperBEAM balance read doesn't blank the others (per-token failure, not Promise.all)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["goodProc", "badProc"]);
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
                      id: "goodProc",
                      tags: [
                        { name: "ticker", value: "GOOD" },
                        { name: "denomination", value: "6" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      if (url.includes("badProc")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const balances = await handler.getTokenBalances({ address: "addr1" });

    // Default AO token + goodProc + badProc.
    expect(balances).toHaveLength(3);
    const good = balances.find((b) => b.processId === "goodProc");
    const bad = balances.find((b) => b.processId === "badProc");
    const ao = balances.find((b) => b.processId !== "goodProc" && b.processId !== "badProc");
    expect(good?.quantity).toBe("42");
    expect(good?.available).not.toBe(false);
    expect(bad?.available).toBe(false);
    expect(ao?.available).not.toBe(false);
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

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
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

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
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
  it("throws naming every source it tried when none answers", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage, null);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: LEGACY, tags: LEGACY_TAGS }]) : { ok: false, status: 500, json: async () => ({}) },
    ) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    await expect(handler.tokenBalance({ address: "addr1", id: LEGACY })).rejects.toThrow(/Couldn't read your wAR balance.*cu\.ao-testnet\.xyz/);
  });

  it("resolves a single process id's balance via the active peer", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: LEGACY, tags: LEGACY_TAGS }]) : { ok: true, status: 200, json: async () => "123" },
    ) as unknown as typeof fetch;

    const result = await new ReadsHandler(storage, undefined, noDiscovery).tokenBalance({ address: "addr1", id: LEGACY });

    expect(result).toBe("123");
  });
});

describe("ReadsHandler: userTokens", () => {
  async function seededStorage() {
    const storage = createFakeStorage();
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example.com", enabled: true }],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    return storage;
  }

  it("returns Wander's shape, with a numeric Denomination and no balance by default", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => "42",
    })) as unknown as typeof fetch;

    const tokens = await new ReadsHandler(await seededStorage()).userTokens({ address: "addr1" });

    const ao = tokens.find((t) => t.Ticker === "AO");
    expect(ao).toEqual({ processId: ao?.processId, Name: "AO", Ticker: "AO", Denomination: 12 });
  });

  it("adds each balance when fetchBalance is set", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => "42",
    })) as unknown as typeof fetch;

    const tokens = await new ReadsHandler(await seededStorage()).userTokens({
      address: "addr1",
      options: { fetchBalance: true },
    });

    expect(tokens.find((t) => t.Ticker === "AO")?.balance).toBe("42");
  });

  it("keeps a token with no resolved metadata, leaving out Name and the process-id ticker fallback", async () => {
    const storage = await seededStorage();
    await storage.set("local:watchedProcessIds:addr1", ["unknownProc"]);

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const tokens = await new ReadsHandler(storage).userTokens({ address: "addr1", options: { fetchBalance: true } });

    const unknown = tokens.find((t) => t.processId === "unknownProc");
    expect(unknown).toBeDefined();
    expect(unknown).not.toHaveProperty("Name");
    expect(unknown).not.toHaveProperty("Ticker");
    // Its denomination can't be confirmed, so it's left out entirely rather
    // than sent as a placeholder/guessed number.
    expect(unknown).not.toHaveProperty("Denomination");
    expect(unknown?.balance).toBeNull();
  });

  it("leaves out Denomination when metadata resolves a ticker but no denomination tag", async () => {
    const storage = await seededStorage();
    await storage.set("local:watchedProcessIds:addr1", ["partialProc"]);

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  { node: { id: "partialProc", tags: [{ name: "Ticker", value: "wUSDC" }] } },
                ],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "42" };
    }) as unknown as typeof fetch;

    const tokens = await new ReadsHandler(storage).userTokens({ address: "addr1", options: { fetchBalance: true } });

    const partial = tokens.find((t) => t.processId === "partialProc");
    expect(partial).toBeDefined();
    expect(partial?.Ticker).toBe("wUSDC");
    expect(partial).not.toHaveProperty("Denomination");
    expect(partial?.balance).toBeNull();
  });
});

describe("ReadsHandler: getWatchedTokens / previewWatchedToken / addWatchedToken / removeWatchedToken", () => {
  it("returns an empty list when nothing has been watched yet", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("previewWatchedToken resolves the balance without storing the process id", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: FODDER, tags: FODDER_TAGS }]) : { ok: true, status: 200, json: async () => "1000000" },
    ) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    const balance = await handler.previewWatchedToken({ address: "addr1", processId: FODDER });

    expect(balance.quantity).toBe("1000000");
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("previewWatchedToken still previews a token whose balance can't be read right now, saying why", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: FODDER, tags: FODDER_TAGS }]) : { ok: false, status: 403, json: async () => ({}) },
    ) as unknown as typeof fetch;

    const balance = await new ReadsHandler(storage, undefined, noDiscovery).previewWatchedToken({ address: "addr1", processId: FODDER });

    expect(balance).toMatchObject({ ticker: "FODDER", available: false });
    expect(balance.unavailableReason).toMatch(/Couldn't read your FODDER balance/);
  });

  it("previewWatchedToken explains a malformed id, an unknown id and a collectible", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    await expect(handler.previewWatchedToken({ address: "addr1", processId: "proc1" })).rejects.toThrow(/isn't a process id/);

    globalThis.fetch = vi.fn(async () => graphqlNodes([])) as unknown as typeof fetch;
    await expect(handler.previewWatchedToken({ address: "addr1", processId: FODDER })).rejects.toThrow(/No process with that id/);

    const nft = "N".repeat(43);
    globalThis.fetch = vi.fn(async () =>
      graphqlNodes([
        {
          id: nft,
          tags: [
            { name: "device", value: "process@1.0" },
            { name: "execution-device", value: "token@1.0" },
            { name: "hint-ui-style", value: "non-fungible" },
            { name: "denomination", value: "0" },
            { name: "total-supply", value: "1" },
            { name: "ticker", value: "ASSET" },
          ],
        },
      ]),
    ) as unknown as typeof fetch;
    await expect(handler.previewWatchedToken({ address: "addr1", processId: nft })).rejects.toThrow(/collectible/);
  });

  it("previewWatchedToken rejects an empty process id", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    await expect(handler.previewWatchedToken({ address: "addr1", processId: "  " })).rejects.toThrow(
      /Paste a token's process id/,
    );
  });

  it("adds a process id after validating it, returns the resolved balance and un-hides it", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    await storage.set("local:hiddenProcessIds:addr1", [FODDER]);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: FODDER, tags: FODDER_TAGS }]) : { ok: true, status: 200, json: async () => "1000000" },
    ) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    const balance = await handler.addWatchedToken({ address: "addr1", processId: FODDER });

    expect(balance.processId).toBe(FODDER);
    expect(balance.quantity).toBe("1000000");
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([FODDER]);
    expect(await storage.get("local:hiddenProcessIds:addr1")).toEqual([]);
  });

  it("rejects an empty process id without writing to storage", async () => {
    const storage = createFakeStorage();
    const handler = new ReadsHandler(storage);
    await expect(handler.addWatchedToken({ address: "addr1", processId: "  " })).rejects.toThrow(
      /Paste a token's process id/,
    );
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("refuses an id the gateway can't find, rather than silently adding an unresolved token", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async () => graphqlNodes([])) as unknown as typeof fetch;
    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    await expect(handler.addWatchedToken({ address: "addr1", processId: FODDER })).rejects.toThrow(/No process with that id/);
    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([]);
  });

  it("does not add a duplicate when the process id is already watched", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", [FODDER]);
    await peerSettings(storage);
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes("/graphql") ? graphqlNodes([{ id: FODDER, tags: FODDER_TAGS }]) : { ok: true, status: 200, json: async () => "5" },
    ) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage, undefined, noDiscovery);
    await handler.addWatchedToken({ address: "addr1", processId: FODDER });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual([FODDER]);
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

  it("hides a removed token, watched or not, so discovery doesn't bring it back", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);

    const handler = new ReadsHandler(storage);
    await handler.removeWatchedToken({ address: "addr1", processId: "not-watched" });

    expect(await handler.getWatchedTokens({ address: "addr1" })).toEqual(["proc1"]);
    expect(await storage.get("local:hiddenProcessIds:addr1")).toEqual(["not-watched"]);
  });
});

describe("ReadsHandler: isTokenAdded", () => {
  it("is true for a watched id, per address, and false otherwise", async () => {
    const storage = createFakeStorage();
    await storage.set("local:watchedProcessIds:addr1", ["proc1"]);
    const handler = new ReadsHandler(storage);

    expect(await handler.isTokenAdded({ address: "addr1", processId: "proc1" })).toBe(true);
    expect(await handler.isTokenAdded({ address: "addr1", processId: "proc2" })).toBe(false);
    expect(await handler.isTokenAdded({ address: "addr2", processId: "proc1" })).toBe(false);
  });

  it("is true for the AO token, which is always listed without being stored", async () => {
    const handler = new ReadsHandler(createFakeStorage());
    expect(
      await handler.isTokenAdded({ address: "addr1", processId: "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc" }),
    ).toBe(true);
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
      currentValue: 0,
      change: 0,
      periodLabel: "Last 7 days",
    });
  });

  it("prices the active wallet's current AR balance across the fetched price series", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activeWalletId", "w1");

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("wallet/addr1/balance")) {
        return { ok: true, status: 200, text: async () => "2000000000000" }; // 2 AR
      }
      if (url.includes("/prices/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            series: [
              { timestamp: 1000, usd: 10 },
              { timestamp: 2000, usd: 20 },
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
      { timestamp: 1000, value: 20 },
      { timestamp: 2000, value: 40 },
    ]);
    expect(history.currentValue).toBe(40);
    expect(history.change).toBeCloseTo(1); // doubled: (40 - 20) / 20
  });

  it("with scope all, prices the summed AR balance of every stored wallet, counting a repeated address once", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      { id: "w2", address: "addr2", name: "Wallet Two", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      { id: "w3", address: "addr1", name: "Wallet One again", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activeWalletId", "w1");
    await storage.set("local:networkSettings", { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null });

    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes("wallet/addr1/balance")) return { ok: true, status: 200, text: async () => "2000000000000" }; // 2 AR
      if (url.includes("wallet/addr2/balance")) return { ok: true, status: 200, text: async () => "3000000000000" }; // 3 AR
      if (url.includes("/prices/history")) {
        return { ok: true, status: 200, json: async () => ({ series: [{ timestamp: 1000, usd: 10 }, { timestamp: 2000, usd: 20 }] }) };
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage);
    const allWallets = await handler.getPortfolioHistory({ range: "7D", scope: "all" });
    expect(allWallets.series).toEqual([
      { timestamp: 1000, value: 50 },
      { timestamp: 2000, value: 100 },
    ]);

    const activeOnly = await handler.getPortfolioHistory({ range: "7D", scope: "wallet" });
    expect(activeOnly.currentValue).toBe(40);
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
    expect(history.currentValue).toBe(0);
    expect(history.change).toBe(0);
  });
});

describe("ReadsHandler: display currency", () => {
  async function walletStorage() {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "w1", address: "addr1", name: "Wallet One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await storage.set("local:activeWalletId", "w1");
    await storage.set("local:networkSettings", { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null });
    return storage;
  }

  // 2 AR, no AO; AR went from $10 to $20 while EUR is 0.5 per dollar.
  function pricedFetch({ fxRate = 0.5 as number | null } = {}) {
    return vi.fn(async (url: string) => {
      if (url.includes("wallet/addr1/balance")) return { ok: true, status: 200, text: async () => "2000000000000" };
      if (url.includes("/prices/fx")) return { ok: true, status: 200, json: async () => ({ rate: fxRate }) };
      if (url.includes("/prices/history")) {
        return { ok: true, status: 200, json: async () => ({ series: [{ timestamp: 1000, usd: 10 }, { timestamp: 2000, usd: 20 }] }) };
      }
      if (url.includes("/prices?ids=arweave")) return { ok: true, status: 200, json: async () => ({ prices: { arweave: 20 } }) };
      if (url.includes("/prices?ids=ao-computer")) return { ok: true, status: 200, json: async () => ({ prices: { "ao-computer": 5 } }) };
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as unknown as typeof fetch;
  }

  it("charts a fiat currency at today's exchange rate", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(await walletStorage()).getPortfolioHistory({ range: "7D", currency: "EUR" });

    expect(history.series).toEqual([
      { timestamp: 1000, value: 10 },
      { timestamp: 2000, value: 20 },
    ]);
    expect(history.change).toBeCloseTo(1);
  });

  it("charts AR at AR's price at each point, so an AR-only wallet is flat", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(await walletStorage()).getPortfolioHistory({ range: "7D", currency: "AR" });

    expect(history.series).toEqual([
      { timestamp: 1000, value: 2 },
      { timestamp: 2000, value: 2 },
    ]);
    expect(history.change).toBe(0);
  });

  it("reports a failed range when the exchange rate is unavailable", async () => {
    globalThis.fetch = pricedFetch({ fxRate: null });
    const history = await new ReadsHandler(await walletStorage()).getPortfolioHistory({ range: "7D", currency: "GBP" });

    expect(history.series).toEqual([]);
  });

  it("prices each token in the display currency", async () => {
    globalThis.fetch = pricedFetch();
    const handler = new ReadsHandler(createFakeStorage());

    expect(await handler.getTokenPrices({ currency: "EUR" })).toEqual([
      { processId: null, price: 10 },
      { processId: AO, price: 2.5 },
    ]);
    expect(await handler.getTokenPrices({ currency: "AO" })).toEqual([
      { processId: null, price: 4 },
      { processId: AO, price: 1 },
    ]);
  });

  it("leaves every token unpriced when the exchange rate is unavailable", async () => {
    globalThis.fetch = pricedFetch({ fxRate: null });

    expect(await new ReadsHandler(createFakeStorage()).getTokenPrices({ currency: "EUR" })).toEqual([
      { processId: null, price: null },
      { processId: AO, price: null },
    ]);
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
  it("schedules the named timer and advances a pending entry to confirmed when it fires", async () => {
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
    let tick: (() => void) | undefined;
    const every = vi.fn((_name: string, _periodMinutes: number, run: () => void) => {
      tick = run;
    });
    registerActivityPromotionAlarm(handler, { every });

    expect(every).toHaveBeenCalledWith(ACTIVITY_PROMOTION_ALARM_NAME, 1, expect.any(Function));

    tick?.();
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

describe("ReadsHandler: discovered tokens", () => {
  const WALLET = "W".repeat(43);
  const SPAM = "S".repeat(43);
  const FAKE_AO = "F".repeat(43);
  const EMPTY = "E".repeat(43);

  function meta(processId: string, ticker: string) {
    return {
      processId,
      transport: "l1" as const,
      assetClass: "fungible" as const,
      denomination: 12,
      ticker,
      name: ticker,
      description: null,
      logo: null,
      totalSupply: null,
    };
  }

  it("lists a discovered token with a balance, and drops empty, hidden and AO-impersonating ones", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    await storage.set(`local:hiddenProcessIds:${WALLET}`, [SPAM]);
    const discover = vi.fn(async () => [meta(FODDER, "FODDER"), meta(SPAM, "SPAM"), meta(FAKE_AO, "w\u200BA0"), meta(EMPTY, "NONE")]);
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes(EMPTY)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => "1000000000000" };
    }) as unknown as typeof fetch;

    const handler = new ReadsHandler(storage, undefined, discover);
    const balances = await handler.getTokenBalances({ address: WALLET });

    expect(balances.map((b) => b.processId)).toEqual([AO, FODDER]);
    expect(balances[1]).toMatchObject({ ticker: "FODDER", source: "discovered", quantity: "1000000000000" });
    // Seeded metadata means no per-token gateway lookup.
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/graphql"))).toBe(false);

    await handler.getTokenBalances({ address: WALLET });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("serves the last result when a later discovery fails", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    await storage.set(`local:discoveredTokens:${WALLET}`, { savedAt: 0, processIds: [FODDER] });
    await storage.set(`local:tokenMetadata:${FODDER}`, meta(FODDER, "FODDER"));
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => "5" })) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, async () => {
      throw new Error("gateway down");
    }).getTokenBalances({ address: WALLET });

    expect(balances.map((b) => b.processId)).toEqual([AO, FODDER]);
  });

  it("shows an L1 receipt for a listed fungible token as unverified, and drops one for any other process", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    await storage.set(`local:tokenMetadata:${FODDER}`, meta(FODDER, "FODDER"));
    await storage.set(`local:discoveredTokens:${WALLET}`, { savedAt: Date.now(), processIds: [FODDER] });
    const sender = "U".repeat(43);
    const receipt = (id: string, quantity: string, target = FODDER) => ({
      cursor: id,
      node: {
        id,
        owner: { address: sender },
        recipient: target,
        quantity: { winston: "0" },
        tags: [
          { name: "action", value: "transfer" },
          { name: "recipient", value: WALLET },
          { name: "quantity", value: quantity },
        ],
        block: { timestamp: 10 },
      },
    });
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const edges = body.includes("values: $address") ? [receipt("r-many", "311"), receipt("r-one", "1"), receipt("forged", "1000000000", SPAM)] : [];
      return { ok: true, status: 200, json: async () => ({ data: { transactions: { edges } } }) };
    }) as unknown as typeof fetch;

    const page = await new ReadsHandler(storage, undefined, noDiscovery).getActivity({ address: WALLET });

    expect(page.entries.find((e) => e.txId === "r-many")).toMatchObject({
      type: "receive",
      token: FODDER,
      amount: "311",
      address: sender,
      unverified: true,
    });
    const one = page.entries.find((e) => e.txId === "r-one");
    expect(one).toMatchObject({ type: "receive", token: FODDER, amount: "1" });
    expect(one?.collectible).toBeUndefined();
    expect(page.entries.find((e) => e.txId === "forged")).toBeUndefined();
  });
});

describe("ReadsHandler: discovered balance validation", () => {
  it("drops a discovered row whose node answered a non-numeric quantity instead of failing the list", async () => {
    const storage = createFakeStorage();
    await peerSettings(storage);
    const weird = "Q".repeat(43);
    const discover = async () => [
      { processId: weird, transport: "l1" as const, assetClass: "fungible" as const, denomination: 6, ticker: "Q", name: "Q", description: null, logo: null, totalSupply: null },
    ];
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes(weird) ? { ok: true, status: 200, json: async () => ({ balance: "12abc" }) } : { ok: true, status: 200, json: async () => "5" },
    ) as unknown as typeof fetch;

    const balances = await new ReadsHandler(storage, undefined, discover).getTokenBalances({ address: "W".repeat(43) });

    expect(balances.map((b) => b.processId)).toEqual([AO]);
  });
});
