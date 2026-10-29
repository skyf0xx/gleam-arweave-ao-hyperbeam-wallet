import { fakeBrowser } from "./fake-browser.testing";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionQueryCache } from "./query-cache";

afterEach(() => fakeBrowser.reset());

describe("extension query cache", () => {
  it("stores entries in storage.local and clears only its own", async () => {
    await fakeBrowser.storage.local.set({ wallets: ["kept"] });
    const cache = createExtensionQueryCache();
    await cache.set("w1", "one");
    await cache.set("w2", "two");
    expect(await cache.get("w1")).toBe("one");
    expect((await cache.keys()).sort()).toEqual(["w1", "w2"]);

    await cache.remove("w1");
    expect(await cache.get("w1")).toBeNull();

    await cache.clear();
    expect(await cache.get("w2")).toBeNull();
    expect(await fakeBrowser.storage.local.get("wallets")).toEqual({ wallets: ["kept"] });
  });
});
