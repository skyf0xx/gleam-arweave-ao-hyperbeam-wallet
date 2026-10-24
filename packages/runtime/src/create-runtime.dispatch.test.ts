import { describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { GLEAM_SITES_KEY, otherWalletKey } from "./handlers/site-wallet";
import { SITE_ORIGIN } from "@gleam/core/src/models/site-origin.ts";
import { createRuntime } from "./create-runtime";
import { createInMemoryPlatform } from "../testing/index";

const ORIGIN = "https://dapp.example";
const EXTENSION: CallerContext = { tier: "extension" };
const CONTENT_SCRIPT: CallerContext = { tier: "contentScript", origin: ORIGIN, tabId: 7 };

function setup() {
  const platform = createInMemoryPlatform();
  const onDismissed = vi.spyOn(platform.approvalPresenter, "onDismissed");
  return { platform, storage: platform.storage, onDismissed, runtime: createRuntime(platform) };
}

describe("createRuntime", () => {
  it("registers its timers and the approval dismissal listener while it runs", () => {
    const { platform, onDismissed } = setup();

    expect(platform.timer.schedule("auto-lock")).toMatchObject({ periodMinutes: 1 });
    expect(onDismissed).toHaveBeenCalledTimes(1);
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
