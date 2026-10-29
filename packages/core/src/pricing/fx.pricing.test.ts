import { describe, expect, it, vi } from "vitest";
import { getUsdFxRate } from "./fx";

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
}

describe("getUsdFxRate", () => {
  it("reads the rate from the server's FX proxy", async () => {
    const fetchImpl = respond(200, { currency: "EUR", rate: 0.92 });

    expect(await getUsdFxRate("EUR", "https://api.example", fetchImpl)).toBe(0.92);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/prices/fx?currency=EUR", { signal: expect.any(AbortSignal) });
  });

  it("answers 1 for USD without a request", async () => {
    const fetchImpl = respond(200, {});

    expect(await getUsdFxRate("USD", "https://api.example", fetchImpl)).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["an error status", respond(500, {})],
    ["a null rate", respond(200, { rate: null })],
    ["a zero rate", respond(200, { rate: 0 })],
    ["a network failure", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch],
  ])("answers null on %s", async (_, fetchImpl) => {
    expect(await getUsdFxRate("GBP", "https://api.example", fetchImpl)).toBeNull();
  });
});
