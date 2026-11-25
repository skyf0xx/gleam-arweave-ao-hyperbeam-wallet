// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createPgPriceStore } from "./price-store";
import { createPriceService } from "./prices";
import { createTestDb } from "../testing/test-db";

const MINUTE = 60_000;

function upstream(body: () => unknown) {
  const calls: string[] = [];
  let failing = false;
  const fetchImpl = (async (input: string) => {
    calls.push(input);
    return failing
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => body() };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, fail: () => (failing = true) };
}

const spot = () => ({ arweave: { usd: 5 }, "ao-computer": { usd: 2 } });

describe("createPgPriceStore", () => {
  it("keeps one row per key, holding the latest answer", async () => {
    const store = createPgPriceStore(await createTestDb());

    await store.save({ key: "spot", value: { arweave: 1 }, fetchedAt: 1_000, expiresAt: 2_000 });
    await store.save({ key: "spot", value: { arweave: 2 }, fetchedAt: 3_000, expiresAt: 4_000 });

    expect(await store.load()).toEqual([{ key: "spot", value: { arweave: 2 }, fetchedAt: 3_000, expiresAt: 4_000 }]);
  });
});

describe("a price service with a store", () => {
  it("answers from the store after a restart, without calling upstream", async () => {
    const db = await createTestDb();
    const clock = 1_000_000;
    const first = upstream(spot);
    await createPriceService({ coinGeckoApiKey: "k", fetchImpl: first.fetchImpl, now: () => clock, store: createPgPriceStore(db) }).spot(["arweave"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = upstream(spot);
    const restarted = createPriceService({ coinGeckoApiKey: "k", fetchImpl: second.fetchImpl, now: () => clock + MINUTE, store: createPgPriceStore(db) });

    expect(await restarted.spot(["arweave", "ao-computer"])).toEqual({ arweave: 5, "ao-computer": 2 });
    expect(second.calls).toHaveLength(0);
  });

  it("serves the stored answer after a restart when every upstream is down", async () => {
    const db = await createTestDb();
    await createPriceService({ coinGeckoApiKey: "k", fetchImpl: upstream(spot).fetchImpl, now: () => 0, store: createPgPriceStore(db) }).spot(["arweave"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const down = upstream(spot);
    down.fail();
    const restarted = createPriceService({ coinGeckoApiKey: "k", fetchImpl: down.fetchImpl, now: () => 60 * MINUTE, store: createPgPriceStore(db) });

    expect(await restarted.spot(["arweave"])).toEqual({ arweave: 5 });
    expect(down.calls.length).toBeGreaterThan(0);
  });

  it("starts empty when the store can't be read", async () => {
    const { fetchImpl, calls } = upstream(spot);
    const store = { load: () => Promise.reject(new Error("down")), save: () => Promise.resolve() };

    expect(await createPriceService({ coinGeckoApiKey: "k", fetchImpl, now: () => 0, store }).spot(["arweave"])).toEqual({ arweave: 5 });
    expect(calls).toHaveLength(1);
  });
});
