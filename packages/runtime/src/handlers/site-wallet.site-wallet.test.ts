import { describe, expect, it } from "vitest";
import { UNKNOWN_WALLET_NAME, type Grant, type StoragePort } from "@gleam/core";
import { SiteWalletHandler } from "./site-wallet";

const ORIGIN = "https://bazar.arweave.net";

function memoryStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: async (key, value) => {
      store.set(key, value);
    },
    setMany: async (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
    },
    remove: async (key) => {
      store.delete(key);
    },
    watch: () => () => undefined,
  };
}

const GRANT: Grant = {
  origin: ORIGIN,
  walletId: "wallet-1",
  permissions: ["ACCESS_ADDRESS"],
  createdAt: 0,
  expiresAt: null,
  budget: null,
};

function handler(grants: Grant[] = [], now = () => 1_000) {
  return new SiteWalletHandler({
    storage: memoryStorage(),
    findActiveGrant: async (origin) => grants.find((grant) => grant.origin === origin) ?? null,
    now,
  });
}

describe("SiteWalletHandler", () => {
  it("uses Gleam on a site that holds a grant", async () => {
    const sites = handler([GRANT]);
    expect(await sites.mode(ORIGIN)).toEqual({ useGleam: true });
    expect(await sites.mode("https://other.example")).toEqual({ useGleam: false });
  });

  it("keeps using Gleam on a site the user chose, with or without a grant", async () => {
    const sites = handler();
    await sites.setUseGleam(ORIGIN, true);
    expect(await sites.mode(ORIGIN)).toEqual({ useGleam: true });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.usesGleam).toBe(true);

    await sites.setUseGleam(ORIGIN, false);
    expect(await sites.mode(ORIGIN)).toEqual({ useGleam: false });
  });

  it("forgets every chosen site at once", async () => {
    const sites = handler();
    await sites.setUseGleam(ORIGIN, true);
    await sites.setUseGleam("https://other.example", true);
    await expect(sites.forgetGleamSites()).resolves.toEqual([ORIGIN, "https://other.example"]);
    expect(await sites.mode(ORIGIN)).toEqual({ useGleam: false });
    expect(await sites.mode("https://other.example")).toEqual({ useGleam: false });
  });

  it("keeps each tab's report apart", async () => {
    const sites = handler();
    await Promise.all([
      sites.report(7, ORIGIN, { walletName: "Wander", used: true }),
      sites.report(8, "https://other.example", { walletName: "PermawebOS", used: false }),
    ]);
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWallet).toBe("Wander");
    expect((await sites.activeSite({ id: 8, url: "https://other.example" }))?.otherWallet).toBe("PermawebOS");
  });

  it("describes the active tab with the other wallet the page reported", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: "Wander", used: false });
    expect(await sites.activeSite({ id: 7, url: `${ORIGIN}/swap` })).toEqual({
      origin: ORIGIN,
      favIconUrl: null,
      otherWallet: "Wander",
      otherWalletUsedAt: null,
      otherWalletPermissions: [],
      grant: null,
      usesGleam: false,
      suggestionDismissed: false,
    });

    await sites.report(7, ORIGIN, { walletName: "Wander", used: true });
    expect((await sites.activeSite({ id: 7, url: `${ORIGIN}/swap` }))?.otherWalletUsedAt).toBe(1_000);
  });

  it("keeps a use across a reload of the same site, and forgets it after navigating elsewhere", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: "Wander", used: true });
    await sites.report(7, ORIGIN, { walletName: "Wander", used: false });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWalletUsedAt).toBe(1_000);

    await sites.report(7, "https://other.example", { walletName: "Wander", used: false });
    expect((await sites.activeSite({ id: 7, url: "https://other.example" }))?.otherWalletUsedAt).toBeNull();
  });

  it("records the permissions the page asked the other wallet for, keeping only known ones", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, {
      walletName: "Wander",
      used: true,
      permissions: ["ACCESS_ADDRESS", "SIGNATURE", "SIGNATURE", "MAKE_ME_RICH", 42],
    });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWalletPermissions).toEqual(["ACCESS_ADDRESS", "SIGNATURE"]);

    // A later report without permissions, as on a reload, keeps them.
    await sites.report(7, ORIGIN, { walletName: "Wander", used: false });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWalletPermissions).toEqual(["ACCESS_ADDRESS", "SIGNATURE"]);

    await sites.report(7, "https://other.example", { walletName: "Wander", used: true });
    expect((await sites.activeSite({ id: 7, url: "https://other.example" }))?.otherWalletPermissions).toEqual([]);
  });

  it("doesn't carry a report over to a different site in the same tab", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: "Wander", used: true });
    expect((await sites.activeSite({ id: 7, url: "https://other.example" }))?.otherWallet).toBeNull();
  });

  it("shows a name it doesn't recognise as 'another wallet'", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: "Send your seed phrase to scam.example", used: true });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWallet).toBe(UNKNOWN_WALLET_NAME);
  });

  it("ignores a malformed report", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: 1, used: "yes" });
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWallet).toBeNull();
  });

  it("forgets a closed tab", async () => {
    const sites = handler();
    await sites.report(7, ORIGIN, { walletName: "Wander", used: true });
    await sites.forgetTab(7);
    expect((await sites.activeSite({ id: 7, url: ORIGIN }))?.otherWallet).toBeNull();
  });

  it("has no active site for a non-web tab", async () => {
    const sites = handler();
    expect(await sites.activeSite({ id: 7, url: "chrome://extensions" })).toBeNull();
    expect(await sites.activeSite(undefined)).toBeNull();
  });

  it("remembers a dismissed suggestion per origin", async () => {
    const sites = handler([GRANT]);
    await sites.dismiss(ORIGIN);
    await sites.dismiss(ORIGIN);
    const site = await sites.activeSite({ id: 7, url: ORIGIN });
    expect(site?.suggestionDismissed).toBe(true);
    expect(site?.grant).toEqual(GRANT);
    expect((await sites.activeSite({ id: 7, url: "https://other.example" }))?.suggestionDismissed).toBe(false);
  });

  it.each([
    ["https://bazar.arweave.net/favicon.ico", "https://bazar.arweave.net/favicon.ico"],
    ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    ["data:image/svg+xml;utf8,<svg/>", "data:image/svg+xml;utf8,<svg/>"],
    ["http://bazar.arweave.net/favicon.ico", null],
    ["javascript:alert(1)", null],
    ["data:text/html;base64,AAAA", null],
  ])("passes favicon %s through as %s", async (favIconUrl, expected) => {
    const site = await handler().activeSite({ id: 7, url: ORIGIN, favIconUrl });
    expect(site?.favIconUrl).toBe(expected);
  });
});
