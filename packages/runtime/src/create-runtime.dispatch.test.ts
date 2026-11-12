import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUNDLER_URL, WATCH_ONLY_CONNECT_REFUSAL, type NetworkSettings, type WalletSummary } from "@gleam/core";
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

  describe("a transaction with no reward of its own", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const CUSTOM_BUNDLER = "https://upload.ardrive.io/v1";

    /** A gateway that quotes low for the preview and high for anything after it. */
    function stubLyingGateway() {
      const quotes = ["1", "999999999999"];
      const posted: Array<Record<string, unknown>> = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(DEFAULT_BUNDLER_URL) || url.startsWith(CUSTOM_BUNDLER)) return new Response("OK");
        if (url.includes("/price/")) return new Response(quotes.shift() ?? "999999999999");
        if (url.includes("tx_anchor")) return new Response("b".repeat(64));
        if (url.endsWith("/balance")) return new Response("1000000000000");
        if (url.endsWith("/tx") && init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response("OK");
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;
      return posted;
    }

    async function setupGranted() {
      const context = setup();
      const present = vi.spyOn(context.platform.approvalPresenter, "present");
      const wallet = (await context.runtime.dispatch("createWallet", { name: "Main", password: "correct horse" }, EXTENSION)) as WalletSummary;
      await context.storage.set("local:grants", [
        {
          origin: ORIGIN,
          walletId: wallet.id,
          permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION", "DISPATCH"],
          createdAt: Date.now(),
          expiresAt: null,
          budget: null,
        },
      ]);
      return { ...context, present };
    }

    // An AR send keeps a dispatch on L1, where it pays a fee.
    it.each(["sign", "dispatch"])("%s pays the fee the preview showed, whatever the gateway quotes next", async (method) => {
      const posted = stubLyingGateway();
      const { runtime, present } = await setupGranted();
      const transaction = { data: "aGVsbG8", target: "r".repeat(43), quantity: "10" };

      const pending = runtime.dispatch("providerCall", { method, params: { transaction } }, CONTENT_SCRIPT);
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      await expect(runtime.dispatch("getApproval", { requestId }, EXTENSION)).resolves.toMatchObject({ preview: { fee: "1" } });
      await runtime.dispatch("resolveApproval", { requestId, approved: true }, EXTENSION);
      const result = (await pending) as Record<string, unknown>;

      if (method === "sign") expect(result.reward).toBe("1");
      else expect(posted).toEqual([expect.objectContaining({ reward: "1" })]);
    });

    it("a data dispatch shows no fee and posts to the bundler", async () => {
      const posted = stubLyingGateway();
      const { runtime, present } = await setupGranted();

      const pending = runtime.dispatch("providerCall", { method: "dispatch", params: { transaction: { data: "aGVsbG8" } } }, CONTENT_SCRIPT);
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      await expect(runtime.dispatch("getApproval", { requestId }, EXTENSION)).resolves.toMatchObject({ preview: { fee: null } });
      await runtime.dispatch("resolveApproval", { requestId, approved: true }, EXTENSION);

      await expect(pending).resolves.toMatchObject({ type: "BUNDLED" });
      expect(posted).toEqual([]);
      const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
      expect(urls).toContain(`${DEFAULT_BUNDLER_URL}/tx`);
      expect(urls.some((url) => url.includes("/price/"))).toBe(false);
    });

    it("a data dispatch posts to the bundler set in network settings, under its path", async () => {
      stubLyingGateway();
      const { runtime, present } = await setupGranted();
      const settings = (await runtime.dispatch("getNetworkSettings", undefined, EXTENSION)) as NetworkSettings;
      await runtime.dispatch("setNetworkSettings", { ...settings, bundlerUrl: CUSTOM_BUNDLER }, EXTENSION);

      const pending = runtime.dispatch("providerCall", { method: "dispatch", params: { transaction: { data: "aGVsbG8" } } }, CONTENT_SCRIPT);
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      await runtime.dispatch("resolveApproval", { requestId: present.mock.calls[0]![0], approved: true }, EXTENSION);

      await expect(pending).resolves.toMatchObject({ type: "BUNDLED" });
      const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
      expect(urls).toContain(`${CUSTOM_BUNDLER}/tx`);
      expect(urls.some((url) => url.startsWith(DEFAULT_BUNDLER_URL))).toBe(false);
    });

    it("a dApp's sign of an L1 token transfer shows the token, recipient and amount it moves", async () => {
      stubLyingGateway();
      const { runtime, present } = await setupGranted();
      const token = "t".repeat(43);
      const recipient = "r".repeat(43);
      const b64u = (text: string) => Buffer.from(text).toString("base64url");
      const tags = [
        { name: b64u("action"), value: b64u("transfer") },
        { name: b64u("recipient"), value: b64u(recipient) },
        { name: b64u("quantity"), value: b64u("5000000") },
      ];

      const pending = runtime.dispatch("providerCall", { method: "sign", params: { transaction: { target: token, quantity: "0", tags } } }, CONTENT_SCRIPT);
      void (pending as Promise<unknown>).catch(() => {});
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      await expect(runtime.dispatch("getApproval", { requestId }, EXTENSION)).resolves.toMatchObject({
        preview: { recipient, amount: "5000000", token },
      });
      await runtime.dispatch("resolveApproval", { requestId, approved: false }, EXTENSION);
    });

    async function previewOfSign(transaction: Record<string, unknown>) {
      stubLyingGateway();
      const { runtime, present } = await setupGranted();
      const pending = runtime.dispatch("providerCall", { method: "sign", params: { transaction } }, CONTENT_SCRIPT);
      void (pending as Promise<unknown>).catch(() => {});
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      const request = (await runtime.dispatch("getApproval", { requestId }, EXTENSION)) as { preview: Record<string, unknown> };
      await runtime.dispatch("resolveApproval", { requestId, approved: false }, EXTENSION);
      return request.preview;
    }

    const b64u = (text: string) => Buffer.from(text).toString("base64url");
    const tag = (name: string, value: string) => ({ name: b64u(name), value: b64u(value) });

    it("a dApp's L1 token transfer reads by tag name, beside other tags and in any order or case", async () => {
      const token = "t".repeat(43);
      const recipient = "r".repeat(43);
      const preview = await previewOfSign({
        target: token,
        quantity: "0",
        tags: [tag("Quantity", "5000000"), tag("App-Name", "Dex"), tag("RECIPIENT", recipient), tag("Action", "Transfer")],
      });
      expect(preview).toMatchObject({ recipient, amount: "5000000", token });
      expect(preview.unreadableTokenTransfer).toBeUndefined();
    });

    it("a dApp's transfer-looking transaction it can't read shows as the plain transaction, flagged", async () => {
      const token = "t".repeat(43);
      const recipient = "r".repeat(43);
      const preview = await previewOfSign({
        target: token,
        quantity: "7",
        tags: [tag("action", "transfer"), tag("recipient", recipient), tag("quantity", "5000000")],
      });
      expect(preview).toMatchObject({ recipient: token, amount: "7", token: null, unreadableTokenTransfer: true });
    });

    it("a dApp's sign of a collectible's transfer shows the collectible", async () => {
      stubLyingGateway();
      const { runtime, storage, present } = await setupGranted();
      const asset = "c".repeat(43);
      const recipient = "r".repeat(43);
      await storage.set(`local:tokenMetadata:${asset}`, {
        processId: asset,
        transport: "l1",
        assetClass: "unique",
        denomination: 0,
        ticker: null,
        name: "Art",
        description: null,
        logo: null,
        totalSupply: "1",
      });

      const pending = runtime.dispatch(
        "providerCall",
        {
          method: "sign",
          params: { transaction: { target: asset, quantity: "0", tags: [tag("Action", "Transfer"), tag("Recipient", recipient), tag("Quantity", "1")] } },
        },
        CONTENT_SCRIPT,
      );
      void (pending as Promise<unknown>).catch(() => {});
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      await expect(runtime.dispatch("getApproval", { requestId }, EXTENSION)).resolves.toMatchObject({
        preview: { recipient, amount: "1", collectible: { id: asset } },
      });
      await runtime.dispatch("resolveApproval", { requestId, approved: false }, EXTENSION);
    });

    it("a dApp's transferAoTokens of 1 of a collectible shows the collectible, and of more shows the token", async () => {
      stubLyingGateway();
      const { runtime, storage, present } = await setupGranted();
      const asset = "c".repeat(43);
      const recipient = "r".repeat(43);
      await storage.set(`local:tokenMetadata:${asset}`, {
        processId: asset,
        transport: "l1",
        assetClass: "unique",
        denomination: 0,
        ticker: null,
        name: "Art",
        description: null,
        logo: null,
        totalSupply: "1",
      });
      const previewOfTransfer = async (amount: string) => {
        const pending = runtime.dispatch(
          "providerCall",
          { method: "transferAoTokens", params: { token: asset, recipient, amount } },
          CONTENT_SCRIPT,
        );
        void (pending as Promise<unknown>).catch(() => {});
        await vi.waitFor(() => expect(present).toHaveBeenCalled());
        const requestId = present.mock.calls[0]![0];
        const request = (await runtime.dispatch("getApproval", { requestId }, EXTENSION)) as { preview: Record<string, unknown> };
        await runtime.dispatch("resolveApproval", { requestId, approved: false }, EXTENSION);
        present.mockClear();
        return request.preview;
      };

      expect(await previewOfTransfer("1")).toMatchObject({ recipient, amount: "1", collectible: { id: asset } });
      const more = await previewOfTransfer("5");
      expect(more).toMatchObject({ recipient, amount: "5", token: asset });
      expect(more.collectible).toBeUndefined();
    });

    it("a dApp's sign of 1 unit of a fungible token shows the token", async () => {
      const token = "t".repeat(43);
      const preview = await previewOfSign({
        target: token,
        quantity: "0",
        tags: [tag("Action", "Transfer"), tag("Recipient", "r".repeat(43)), tag("Quantity", "1")],
      });
      expect(preview).toMatchObject({ amount: "1", token });
      expect(preview.collectible).toBeUndefined();
    });

    it("a dApp's ordinary transaction to an address carries no flag", async () => {
      const preview = await previewOfSign({ target: "t".repeat(43), quantity: "7", tags: [tag("action", "eval")] });
      expect(preview.unreadableTokenTransfer).toBeUndefined();
    });

    it("a dApp's L1 token transfer shows the fee and pays exactly that", async () => {
      const posted = stubLyingGateway();
      const { runtime, storage, present } = await setupGranted();
      const token = "t".repeat(43);
      await storage.set(`local:tokenMetadata:${token}`, {
        processId: token,
        transport: "l1",
        assetClass: "fungible",
        denomination: 6,
        ticker: "TKN",
        name: "Token",
        description: null,
        logo: null,
        totalSupply: null,
      });

      const pending = runtime.dispatch(
        "providerCall",
        { method: "transferAoTokens", params: { token, recipient: "r".repeat(43), amount: "5" } },
        CONTENT_SCRIPT,
      );
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      const requestId = present.mock.calls[0]![0];
      await expect(runtime.dispatch("getApproval", { requestId }, EXTENSION)).resolves.toMatchObject({ preview: { fee: "1" } });
      await runtime.dispatch("resolveApproval", { requestId, approved: true }, EXTENSION);
      await pending;

      expect(posted).toEqual([expect.objectContaining({ target: token, reward: "1" })]);
    });
  });

  describe("a watch-only active wallet", () => {
    const WATCHED = "w".repeat(43);

    async function setupWatching() {
      const context = setup();
      const watched = (await context.runtime.dispatch("addWatchWallet", { address: WATCHED }, EXTENSION)) as WalletSummary;
      return { ...context, watched };
    }

    it("refuses a site's connect before any window opens", async () => {
      const { runtime } = await setupWatching();

      await expect(
        runtime.dispatch("providerCall", { method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } }, CONTENT_SCRIPT),
      ).rejects.toThrow(WATCH_ONLY_CONNECT_REFUSAL);
    });

    it("refuses a site that was granted earlier, for reads and signing alike", async () => {
      const { runtime, storage, watched } = await setupWatching();
      await storage.set("local:grants", [
        {
          origin: ORIGIN,
          walletId: watched.id,
          permissions: ["ACCESS_ADDRESS", "SIGNATURE"],
          createdAt: Date.now(),
          expiresAt: null,
          budget: null,
        },
      ]);

      for (const method of ["getActiveAddress", "signMessage"]) {
        await expect(
          runtime.dispatch("providerCall", { method, params: method === "signMessage" ? { data: [1] } : undefined }, CONTENT_SCRIPT),
        ).rejects.toThrow(WATCH_ONLY_CONNECT_REFUSAL);
      }
    });

    it("refuses a site without a grant before decoding its params", async () => {
      const { runtime } = await setupWatching();
      // Params that fail to decode: the grant refusal must come first.
      await expect(runtime.dispatch("providerCall", { method: "sign", params: "not an object" }, CONTENT_SCRIPT)).rejects.toThrow(
        /is not connected/,
      );
    });

    it("refuses \"Use Gleam here\" from the popup", async () => {
      const { runtime, storage } = await setupWatching();

      await expect(
        runtime.dispatch("useGleamOnSite", { origin: ORIGIN, permissions: ["ACCESS_ADDRESS"] }, EXTENSION),
      ).rejects.toThrow(WATCH_ONLY_CONNECT_REFUSAL);
      expect(await storage.get("local:grants")).toBeNull();
    });
  });

  describe("provider events carry only an address the site could read", () => {
    const WATCHED = "w".repeat(43);

    function grantFor(walletId: string, permissions: string[], origin = ORIGIN) {
      return { origin, walletId, permissions, createdAt: Date.now(), expiresAt: null, budget: null };
    }

    async function setupTwoWallets() {
      const context = setup();
      context.platform.tabs.tabs = [{ id: 7, url: `${ORIGIN}/` }];
      const first = (await context.runtime.dispatch("createWallet", { name: "One", password: "correct horse" }, EXTENSION)) as WalletSummary;
      const second = (await context.runtime.dispatch("createWallet", { name: "Two", password: "correct horse" }, EXTENSION)) as WalletSummary;
      await context.runtime.dispatch("switchWallet", { walletId: first.id }, EXTENSION);
      context.platform.tabs.sent.length = 0;
      return { ...context, first, second };
    }

    function walletSwitches(sent: Array<{ data: unknown }>) {
      return sent.filter((entry) => (entry.data as { event?: string }).event === "walletSwitch");
    }

    it("sends walletSwitch with the new address to a site granted ACCESS_ADDRESS", async () => {
      const { runtime, storage, first, second, platform } = await setupTwoWallets();
      await storage.set("local:grants", [grantFor(first.id, ["ACCESS_ADDRESS"])]);

      await runtime.dispatch("switchWallet", { walletId: second.id }, EXTENSION);

      await vi.waitFor(() =>
        expect(platform.tabs.sent).toContainEqual({
          tabId: 7,
          type: "providerEvent",
          data: { origin: ORIGIN, event: "walletSwitch", data: { address: second.address } },
        }),
      );
    });

    it("sends no walletSwitch to a site whose grant lacks ACCESS_ADDRESS", async () => {
      const { runtime, storage, first, second, platform } = await setupTwoWallets();
      await storage.set("local:grants", [grantFor(first.id, ["SIGNATURE"])]);

      await runtime.dispatch("switchWallet", { walletId: second.id }, EXTENSION);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(walletSwitches(platform.tabs.sent)).toEqual([]);
    });

    it("sends no walletSwitch to a plain-http site holding an older grant", async () => {
      const { runtime, storage, first, second, platform } = await setupTwoWallets();
      const insecure = "http://dapp.example";
      platform.tabs.tabs = [{ id: 9, url: `${insecure}/` }];
      await storage.set("local:grants", [grantFor(first.id, ["ACCESS_ADDRESS"], insecure)]);

      await runtime.dispatch("switchWallet", { walletId: second.id }, EXTENSION);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(walletSwitches(platform.tabs.sent)).toEqual([]);
    });

    it("sends no connect event to a site that connected without ACCESS_ADDRESS", async () => {
      const { runtime, platform } = await setupTwoWallets();
      const present = vi.spyOn(platform.approvalPresenter, "present");

      const pending = runtime.dispatch("providerCall", { method: "connect", params: { permissions: ["SIGNATURE"] } }, CONTENT_SCRIPT);
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      await runtime.dispatch("resolveApproval", { requestId: present.mock.calls[0]![0], approved: true }, EXTENSION);
      await expect(pending).resolves.toEqual({ granted: ["SIGNATURE"] });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await expect(
        runtime.dispatch("providerCall", { method: "getActiveAddress", params: undefined }, CONTENT_SCRIPT),
      ).rejects.toThrow("ACCESS_ADDRESS");
      expect(platform.tabs.sent.filter((entry) => (entry.data as { event?: string }).event === "connect")).toEqual([]);
    });

    it("sends the connect event to a site that connected with ACCESS_ADDRESS", async () => {
      const { runtime, platform, first } = await setupTwoWallets();
      const present = vi.spyOn(platform.approvalPresenter, "present");

      const pending = runtime.dispatch("providerCall", { method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } }, CONTENT_SCRIPT);
      await vi.waitFor(() => expect(present).toHaveBeenCalled());
      await runtime.dispatch("resolveApproval", { requestId: present.mock.calls[0]![0], approved: true }, EXTENSION);
      await pending;

      await vi.waitFor(() =>
        expect(platform.tabs.sent).toContainEqual({
          tabId: 7,
          type: "providerEvent",
          data: { origin: ORIGIN, event: "connect", data: { activeAddress: first.address } },
        }),
      );
    });

    it("never sends a watch wallet's address on add, switch or removal fallback", async () => {
      const { runtime, storage, first, second, platform } = await setupTwoWallets();
      await storage.set("local:grants", [grantFor(first.id, ["ACCESS_ADDRESS", "ACCESS_ALL_ADDRESSES"])]);

      const watch = (await runtime.dispatch("addWatchWallet", { address: WATCHED }, EXTENSION)) as WalletSummary;
      await expect(
        runtime.dispatch("providerCall", { method: "getActiveAddress", params: undefined }, CONTENT_SCRIPT),
      ).rejects.toThrow(WATCH_ONLY_CONNECT_REFUSAL);
      await runtime.dispatch("switchWallet", { walletId: first.id }, EXTENSION);
      await runtime.dispatch("switchWallet", { walletId: watch.id }, EXTENSION);
      await runtime.dispatch("deleteWallet", { walletId: second.id }, EXTENSION);
      await runtime.dispatch("switchWallet", { walletId: first.id }, EXTENSION);
      await runtime.dispatch("deleteWallet", { walletId: first.id }, EXTENSION);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const addresses = walletSwitches(platform.tabs.sent).map(
        (entry) => (entry.data as { data: { address: string } }).data.address,
      );
      expect(addresses).not.toContain(WATCHED);
      expect(addresses).toContain(first.address);
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
