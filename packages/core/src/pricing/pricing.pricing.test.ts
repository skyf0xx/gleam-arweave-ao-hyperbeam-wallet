import { describe, expect, it, vi } from "vitest";
import { getUsdPrice } from "./index";

const API = "https://api.example.test";
const AR = { coinGeckoId: "arweave" };

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe("getUsdPrice", () => {
  it("reads the price from the server's proxy, not from a price provider", async () => {
    const fetchImpl = fakeFetch({ prices: { arweave: 11.23 } });
    expect(await getUsdPrice(AR, API, fetchImpl)).toBe(11.23);
    expect(fetchImpl).toHaveBeenCalledWith(`${API}/prices?ids=arweave`, { signal: expect.any(AbortSignal) });
  });

  it("returns null when the id is null or absent in the response", async () => {
    expect(await getUsdPrice(AR, API, fakeFetch({ prices: { arweave: null } }))).toBeNull();
    expect(await getUsdPrice(AR, API, fakeFetch({}))).toBeNull();
  });

  it("returns null rather than a fabricated 0 on a non-2xx response", async () => {
    expect(await getUsdPrice(AR, API, fakeFetch(null, false, 429))).toBeNull();
  });

  it("returns null when the request itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await getUsdPrice(AR, API, fetchImpl)).toBeNull();
  });
});
