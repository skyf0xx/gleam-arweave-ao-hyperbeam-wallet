import { describe, expect, it } from "vitest";
import { memoryQueryCache } from "../app-platform/testing";
import { sweepQueryCache } from "./sweep";

describe("sweepQueryCache", () => {
  it("removes every stored cache whose wallet is gone", async () => {
    const cache = memoryQueryCache(new Map([["w1", "a"], ["w2", "b"], ["w3", "c"]]));
    await sweepQueryCache(cache, new Set(["w1", "w3"]));
    expect([...cache.entries.keys()]).toEqual(["w1", "w3"]);
  });

  it("clears everything when no wallets are left", async () => {
    const cache = memoryQueryCache(new Map([["w1", "a"], ["w2", "b"]]));
    await sweepQueryCache(cache, new Set());
    expect(cache.entries.size).toBe(0);
  });
});
