import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoragePort, TokenMetadata } from "@gleam/core";
import { ReadsHandler } from "./reads";

const ADDRESS = "W".repeat(43);
const TOKEN = "T".repeat(43);
const LOGO = "L".repeat(43);
const TAG_LOGO = "G".repeat(43);

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
});

/** `tokenInfo` is the answer to the state `HEAD` on `compute`; a function throws or builds the Response. */
const stateLogo = (logo: string) => new Response(null, { headers: { logo } });

function stubNetwork(options: { tagLogo?: string; tokenInfo: () => Response }) {
  const tags = [
    { name: "ticker", value: "TKN" },
    { name: "denomination", value: "3" },
    { name: "name", value: "Token" },
    ...(options.tagLogo ? [{ name: "logo", value: options.tagLogo }] : []),
  ];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("~process@1.0/compute&max-age")) return options.tokenInfo();
    if (url.includes("compute/balances")) return Response.json("5000");
    return Response.json({ data: { transactions: { edges: [{ node: { id: TOKEN, tags } }] } } });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const infoCalls = (fn: ReturnType<typeof stubNetwork>) =>
  fn.mock.calls.filter(([url]) => String(url).includes("compute&max-age")).length;

describe("ReadsHandler: token logos from live state", () => {
  it("falls back to the logo in the token's state when the spawn tags have none", async () => {
    const fn = stubNetwork({ tokenInfo: () => stateLogo(LOGO) });
    const row = await new ReadsHandler(createFakeStorage()).previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(row.logoUrl).toBe(`https://arweave.net/${LOGO}`);
    expect(String(fn.mock.calls.find(([url]) => String(url).includes("compute&max-age"))?.[0])).toBe(
      `https://state.forward.computer/${TOKEN}~process@1.0/compute&max-age=60`,
    );
  });

  it("prefers the spawn-tag logo and never reads state", async () => {
    const fn = stubNetwork({ tagLogo: TAG_LOGO, tokenInfo: () => stateLogo(LOGO) });
    const row = await new ReadsHandler(createFakeStorage()).previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(row.logoUrl).toBe(`https://arweave.net/${TAG_LOGO}`);
    expect(infoCalls(fn)).toBe(0);
  });

  it("rejects a state logo that isn't a transaction id", async () => {
    stubNetwork({ tokenInfo: () => stateLogo("https://evil.example/x.png") });
    const row = await new ReadsHandler(createFakeStorage()).previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(row.logoUrl).toBeUndefined();
  });

  it("keeps the token readable with no logo when the state read fails, and asks again next time", async () => {
    const fn = stubNetwork({
      tokenInfo: () => {
        throw new TypeError("offline");
      },
    });
    const reads = new ReadsHandler(createFakeStorage());
    const row = await reads.previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(row.logoUrl).toBeUndefined();
    expect(row.quantity).toBe("5000");
    expect(row.available).not.toBe(false);
    await reads.previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(infoCalls(fn)).toBeGreaterThan(2);
  });

  it("asks once when the node answers, caching the result", async () => {
    const fn = stubNetwork({ tokenInfo: () => stateLogo(LOGO) });
    const reads = new ReadsHandler(createFakeStorage());
    await reads.previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    await reads.previewWatchedToken({ address: ADDRESS, processId: TOKEN });
    expect(infoCalls(fn)).toBe(1);
  });

  it("passes a discovered token's checked logo through, for the popup to draw once the user shows it", async () => {
    stubNetwork({ tagLogo: TAG_LOGO, tokenInfo: () => stateLogo(LOGO) });
    const metadata: TokenMetadata = {
      processId: TOKEN,
      transport: "mu",
      assetClass: "fungible",
      denomination: 3,
      ticker: "TKN",
      name: "Token",
      description: null,
      logo: TAG_LOGO,
      totalSupply: null,
    };
    const reads = new ReadsHandler(createFakeStorage(), undefined, async () => [metadata]);
    const rows = await reads.getTokenBalances({ address: ADDRESS });
    const discovered = rows.find((row) => row.processId === TOKEN);
    expect(discovered?.source).toBe("discovered");
    expect(discovered?.logoUrl).toBe(`https://arweave.net/${TAG_LOGO}`);
  });

  it("keeps tokens an earlier discovery found when a later one misses them", async () => {
    stubNetwork({ tagLogo: TAG_LOGO, tokenInfo: () => stateLogo(LOGO) });
    const storage = createFakeStorage();
    await storage.set(`local:discoveredTokens:${ADDRESS}`, { savedAt: 0, processIds: [TOKEN] });
    const reads = new ReadsHandler(storage, undefined, async () => []);
    await reads.getTokenBalances({ address: ADDRESS });
    await vi.waitFor(async () => {
      const cache = await storage.get<{ savedAt: number; processIds: string[] }>(`local:discoveredTokens:${ADDRESS}`);
      expect(cache?.savedAt).toBeGreaterThan(0);
      expect(cache?.processIds).toEqual([TOKEN]);
    });
  });
});
