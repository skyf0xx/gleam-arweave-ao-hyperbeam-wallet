import { describe, expect, it } from "vitest";
import type { StoragePort } from "@gleam/core";
import { BrowserSitesHandler, BROWSER_RECENT_SITES_KEY, MAX_RECENT_SITES } from "./browser-sites";

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

describe("BrowserSitesHandler", () => {
  it("starts empty", async () => {
    expect(await new BrowserSitesHandler(createFakeStorage()).listBrowserSites()).toEqual({ saved: [], recent: [] });
  });

  it("saves the origin of a page, newest first, without duplicates", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/path?q=1" });
    await handler.saveBrowserSite({ url: "https://b.example/" });
    await handler.saveBrowserSite({ url: "https://a.example/other" });
    expect((await handler.listBrowserSites()).saved).toEqual(["https://a.example", "https://b.example"]);
  });

  it("removes a saved site", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.removeBrowserSite({ origin: "https://a.example" });
    expect((await handler.listBrowserSites()).saved).toEqual([]);
  });

  it("rejects anything that isn't an http(s) URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await expect(handler.saveBrowserSite({ url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(handler.recordRecentSite({ url: "not a url" })).rejects.toThrow();
    expect(await handler.listBrowserSites()).toEqual({ saved: [], recent: [] });
  });

  it("keeps ten recent origins, most recent first, one per origin", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (let index = 0; index < MAX_RECENT_SITES + 2; index += 1) {
      await handler.recordRecentSite({ url: `https://site${index}.example/` });
    }
    await handler.recordRecentSite({ url: "https://site5.example/page" });
    const { recent } = await handler.listBrowserSites();
    expect(recent).toHaveLength(MAX_RECENT_SITES);
    expect(recent[0]).toBe("https://site5.example");
    expect(recent.filter((origin) => origin === "https://site5.example")).toHaveLength(1);
  });

  it("clears only the recent list", async () => {
    const storage = createFakeStorage();
    const handler = new BrowserSitesHandler(storage);
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.recordRecentSite({ url: "https://b.example/" });
    await handler.clearRecentSites();
    expect(await handler.listBrowserSites()).toEqual({ saved: ["https://a.example"], recent: [] });
    expect(await storage.get(BROWSER_RECENT_SITES_KEY)).toBeNull();
  });
});
