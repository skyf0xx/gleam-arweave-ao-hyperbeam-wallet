import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { Keyring } from "@gleam/core/signer";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { GLEAM_SITES_KEY, otherWalletKey } from "./handlers/site-wallet";
import { SITE_ORIGIN } from "@gleam/core/src/models/site-origin.ts";
import { createRuntime } from "./create-runtime";
import type { Platform } from "./platform";

const ORIGIN = "https://dapp.example";
const EXTENSION: CallerContext = { tier: "extension" };
const CONTENT_SCRIPT: CallerContext = { tier: "contentScript", origin: ORIGIN, tabId: 7 };

function memoryStorage(): StoragePort & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get<T>(key: string) {
      return entries.has(key) ? (entries.get(key) as T) : null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async remove(key) {
      entries.delete(key);
    },
    watch: () => () => {},
  };
}

function setup() {
  const storage = memoryStorage();
  const every = vi.fn();
  const platform: Platform = {
    storage,
    sessionKeys: new Keyring(),
    approvalPresenter: {
      present: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      dismiss: vi.fn(async () => {}),
      onDismissed: vi.fn(() => () => {}),
    },
    timer: { every },
    deviceKey: { loadOrCreate: vi.fn() },
    badge: { setDot: vi.fn(async () => {}) },
    lockIndicator: { setLocked: vi.fn(async () => {}) },
    downloads: { isAllowed: vi.fn(), ensureAllowed: vi.fn(), saveFile: vi.fn() },
    tabs: {
      webTabs: vi.fn(async () => []),
      activeTab: vi.fn(async () => undefined),
      reload: vi.fn(async () => {}),
      send: vi.fn(async () => {}),
    },
    version: () => "1.0.0",
    dev: true,
  };
  return { platform, storage, every, runtime: createRuntime(platform) };
}

describe("createRuntime", () => {
  it("registers its timers and the approval dismissal listener while it runs", () => {
    const { platform, every } = setup();

    expect(every).toHaveBeenCalledWith("auto-lock", 1, expect.any(Function));
    expect(platform.approvalPresenter.onDismissed).toHaveBeenCalledTimes(1);
  });

  describe("dispatch", () => {
    it.each<[string, CallerContext | null]>([
      ["a content script", CONTENT_SCRIPT],
      ["a site page", { tier: "site", origin: SITE_ORIGIN }],
      ["no caller", null],
    ])("refuses an extension-tier method from %s", (_name, caller) => {
      const { runtime } = setup();

      expect(() => runtime.dispatch("getLockSettings", undefined, caller)).toThrow(
        '"getLockSettings" can only be called from the Gleam extension.',
      );
    });

    it("answers an extension-tier method from the extension", async () => {
      const { runtime } = setup();

      await expect(runtime.dispatch("getLockSettings", undefined, EXTENSION)).resolves.toMatchObject({
        autoLockTimeout: expect.any(String),
      });
    });

    it.each<[string, CallerContext | null]>([
      ["the extension", EXTENSION],
      ["no caller", null],
    ])("refuses a content-script method from %s", (_name, caller) => {
      const { runtime } = setup();

      expect(() => runtime.dispatch("getSiteWalletMode", undefined, caller)).toThrow(
        "getSiteWalletMode is only accepted from a web page's content script.",
      );
    });

    it("rejects bad params before the handler runs", () => {
      const { runtime, storage } = setup();

      expect(() => runtime.dispatch("reportOtherWallet", { walletName: 1, used: true }, CONTENT_SCRIPT)).toThrow(
        "reportOtherWallet needs a walletName.",
      );
      // A caller with no tab fails the handler's own check, so the parse error proves the handler never ran.
      expect(() =>
        runtime.dispatch("reportOtherWallet", { walletName: 1, used: true }, { ...CONTENT_SCRIPT, tabId: undefined }),
      ).toThrow("reportOtherWallet needs a walletName.");
      expect(storage.entries.has(otherWalletKey(7))).toBe(false);
    });

    it("hands the content-script handler its caller", async () => {
      const { runtime, storage } = setup();
      await storage.set(GLEAM_SITES_KEY, [ORIGIN]);

      await expect(runtime.dispatch("getSiteWalletMode", undefined, CONTENT_SCRIPT)).resolves.toEqual({ useGleam: true });
      await expect(
        runtime.dispatch("getSiteWalletMode", undefined, { ...CONTENT_SCRIPT, origin: "https://other.example" }),
      ).resolves.toEqual({ useGleam: false });

      await runtime.dispatch("reportOtherWallet", { walletName: "Wander", used: false }, CONTENT_SCRIPT);
      expect(storage.entries.get(otherWalletKey(7))).toMatchObject({ origin: ORIGIN, walletName: "Wander" });
      expect(() =>
        runtime.dispatch("reportOtherWallet", { walletName: "Wander", used: false }, { ...CONTENT_SCRIPT, tabId: undefined }),
      ).toThrow("reportOtherWallet is only accepted from a web page's content script.");
    });
  });

  describe("dispatchSite", () => {
    const STATUS = { type: "gleam-points:attest-status" };

    it("answers an unknown type the same whoever sends it", async () => {
      const { runtime } = setup();

      for (const caller of [null, EXTENSION, { tier: "site", origin: SITE_ORIGIN } as const]) {
        await expect(runtime.dispatchSite({ type: "gleam-points:nope" }, caller)).resolves.toEqual({ ok: false });
      }
    });

    it.each<[string, CallerContext | null]>([
      ["no caller", null],
      ["a content script on the site's origin", { ...CONTENT_SCRIPT, origin: SITE_ORIGIN }],
      ["another origin", { tier: "site", origin: "https://evil.example" }],
    ])("refuses a known type from %s", async (_name, caller) => {
      const { runtime } = setup();

      await expect(runtime.dispatchSite(STATUS, caller)).resolves.toEqual({ ok: false });
    });

    it("runs a known type's handler for the site", async () => {
      const { runtime } = setup();

      // The handler's own answer with no wallet, not the refusal.
      await expect(runtime.dispatchSite(STATUS, { tier: "site", origin: SITE_ORIGIN })).resolves.toEqual({
        ok: false,
        code: "no_wallet",
      });
    });
  });
});
