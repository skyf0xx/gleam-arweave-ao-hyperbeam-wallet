import { afterEach, describe, expect, it } from "vitest";
import { createMobileQueryCache } from "./query-cache";

afterEach(() => window.localStorage.clear());

describe("mobile query cache", () => {
  it("stores entries in localStorage and clears only its own", async () => {
    window.localStorage.setItem("gleam:portfolioScope", "all");
    const cache = createMobileQueryCache();
    await cache.set("w1", "one");
    await cache.set("w2", "two");
    expect(await cache.get("w1")).toBe("one");
    expect((await cache.keys()).sort()).toEqual(["w1", "w2"]);

    await cache.remove("w1");
    expect(await cache.get("w1")).toBeNull();

    await cache.clear();
    expect(await cache.get("w2")).toBeNull();
    expect(window.localStorage.getItem("gleam:portfolioScope")).toBe("all");
  });
});
