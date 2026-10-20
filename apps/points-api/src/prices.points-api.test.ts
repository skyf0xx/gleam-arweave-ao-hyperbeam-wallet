// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createPriceService } from "./prices";
import { createTestDb } from "./test-db";

type Handler = (url: string) => { status?: number; body?: unknown };

function upstream(handler: Handler) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string) => {
    calls.push(input);
    const { status = 200, body = {} } = handler(input);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function setup(handler: Handler) {
  const { calls, fetchImpl } = upstream(handler);
  let clock = 1_000_000;
  const prices = createPriceService({ fetchImpl, now: () => clock });
  const app = createApp({ db: await createTestDb(), prices, now: () => new Date(clock) });
  return { app, calls, advance: (ms: number) => (clock += ms) };
}

const gecko: Handler = (url) => {
  if (url.includes("/simple/price")) return { body: { arweave: { usd: 5 }, "ao-computer": { usd: 2 } } };
  return { body: { prices: [[2000, 6], [1000, 5]] } };
};

describe("GET /prices", () => {
  it("answers each requested id from CoinGecko", async () => {
    const { app } = await setup((url) => ({ body: url.includes("ids=ao-computer") ? { "ao-computer": { usd: 2 } } : { arweave: { usd: 5 } } }));

    const response = await app.request("/prices?ids=arweave,ao-computer");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prices: { arweave: 5, "ao-computer": 2 } });
  });

  it("falls back to CoinPaprika when CoinGecko fails", async () => {
    const { app } = await setup((url) =>
      url.includes("coingecko") ? { status: 429 } : { body: { quotes: { USD: { price: 7.5 } } } },
    );

    expect(await (await app.request("/prices?ids=arweave")).json()).toEqual({ prices: { arweave: 7.5 } });
  });

  it("answers null, never 0, when both providers fail", async () => {
    const { app } = await setup(() => ({ status: 500 }));

    const response = await app.request("/prices?ids=arweave");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prices: { arweave: null } });
  });

  it("caches an answer for a minute, so repeated clients don't multiply upstream calls", async () => {
    const { app, calls, advance } = await setup(gecko);

    await app.request("/prices?ids=arweave");
    await app.request("/prices?ids=arweave");
    expect(calls).toHaveLength(1);

    advance(61_000);
    await app.request("/prices?ids=arweave");
    expect(calls).toHaveLength(2);
  });

  it("shares one upstream call between concurrent requests", async () => {
    const { app, calls } = await setup(gecko);

    await Promise.all([app.request("/prices?ids=arweave"), app.request("/prices?ids=arweave")]);

    expect(calls).toHaveLength(1);
  });

  it("remembers a failure only briefly", async () => {
    let failing = true;
    const { app, calls, advance } = await setup((url) => (failing ? { status: 500 } : gecko(url)));

    await app.request("/prices?ids=arweave");
    const failedCalls = calls.length;
    await app.request("/prices?ids=arweave");
    expect(calls).toHaveLength(failedCalls);

    failing = false;
    advance(16_000);
    expect(await (await app.request("/prices?ids=arweave")).json()).toEqual({ prices: { arweave: 5 } });
  });

  it.each(["", "?ids=", "?ids=bitcoin", "?ids=arweave,bitcoin", "?ids=../etc", "?ids=arweave%26vs_currencies%3Deur"])(
    "rejects ids it doesn't know (%s) without calling upstream",
    async (query) => {
      const { app, calls } = await setup(gecko);

      const response = await app.request(`/prices${query}`);

      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );

  it("lets an extension read it and no web page", async () => {
    const { app } = await setup(gecko);
    const preflight = (origin: string) =>
      app.request("/prices", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET" } });

    expect((await preflight("chrome-extension://abc")).headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits a client by IP", async () => {
    const { app } = await setup(gecko);
    const headers = { "x-forwarded-for": "203.0.113.9" };

    let last = 200;
    for (let i = 0; i < 1201; i++) last = (await app.request("/prices?ids=arweave", { headers })).status;

    expect(last).toBe(429);
  });
});

describe("GET /prices/history", () => {
  it("returns a time-ordered series from CoinGecko", async () => {
    const { app, calls } = await setup(gecko);

    const response = await app.request("/prices/history?id=arweave&range=7D");

    expect(await response.json()).toEqual({
      series: [
        { timestamp: 1000, usd: 5 },
        { timestamp: 2000, usd: 6 },
      ],
    });
    expect(calls[0]).toContain("/coins/arweave/market_chart?vs_currency=usd&days=7");
  });

  it("caps ALL at 365 days, which the free tiers can serve", async () => {
    const { app, calls } = await setup(gecko);

    await app.request("/prices/history?id=arweave&range=ALL");

    expect(calls[0]).toContain("days=365");
  });

  it("falls back to CoinPaprika, then to an empty series", async () => {
    const paprika = await setup((url) =>
      url.includes("coingecko") ? { status: 500 } : { body: [{ timestamp: "2024-01-01T00:00:00Z", price: 3.5 }] },
    );
    expect(await (await paprika.app.request("/prices/history?id=arweave&range=1M")).json()).toEqual({
      series: [{ timestamp: new Date("2024-01-01T00:00:00Z").getTime(), usd: 3.5 }],
    });
    expect(paprika.calls[1]).toContain("/tickers/ar-arweave/historical?start=");
    expect(paprika.calls[1]).toContain("interval=1d");

    const down = await setup(() => ({ status: 500 }));
    expect(await (await down.app.request("/prices/history?id=arweave&range=1M")).json()).toEqual({ series: [] });
  });

  it("caches per id and range", async () => {
    const { app, calls } = await setup(gecko);

    await app.request("/prices/history?id=arweave&range=7D");
    await app.request("/prices/history?id=arweave&range=7D");
    await app.request("/prices/history?id=arweave&range=1M");

    expect(calls).toHaveLength(2);
  });

  it.each(["", "?id=arweave", "?id=arweave&range=2D", "?id=bitcoin&range=7D", "?range=7D"])(
    "rejects %s",
    async (query) => {
      const { app, calls } = await setup(gecko);

      expect((await app.request(`/prices/history${query}`)).status).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );
});
