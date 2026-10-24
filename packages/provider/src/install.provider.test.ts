import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport, type FakeTransport } from "../testing/fake-transport";
import { installProvider } from "./install";

const VERSION = "1.29.0";

describe("installProvider routes window.arweaveWallet", () => {
  let teardown: (() => void) | undefined;
  const listeners: Array<[string, () => void]> = [];
  let fake: FakeTransport;

  beforeEach(() => {
    fake = createFakeTransport();
  });

  function install(): () => void {
    return installProvider({ transport: fake.transport, walletVersion: VERSION });
  }

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    for (const [event, listener] of listeners.splice(0)) window.removeEventListener(event, listener);
    vi.useRealTimers();
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.arweaveWallet;
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.permawebConnect;
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.gleam;
  });

  type Wallet = { walletName?: string; connect?: (...args: unknown[]) => unknown; [key: string]: unknown };

  function current(): Wallet | undefined {
    return (window as unknown as { arweaveWallet?: Wallet }).arweaveWallet;
  }

  function installOther(value: unknown, writable = true): void {
    Object.defineProperty(window, "arweaveWallet", {
      value,
      configurable: true,
      writable,
    });
  }

  function wander() {
    return { walletName: "Wander", connect: vi.fn().mockResolvedValue("wander-connected"), events: { on: vi.fn() } };
  }

  const sendSiteMode = (useGleam: boolean) => fake.siteMode(useGleam);
  const otherWalletReports = () => fake.reports;
  const gleamRequests = () => fake.requests;

  it("teardown stops the provider relaying page events", () => {
    const relayed = vi.fn();
    window.addEventListener("walletSwitch", relayed);
    listeners.push(["walletSwitch", relayed]);
    const postEvent = () => fake.push("walletSwitch", {});

    teardown = install();
    postEvent();
    expect(relayed).toHaveBeenCalledTimes(1);

    teardown();
    teardown = undefined;
    postEvent();
    expect(relayed).toHaveBeenCalledTimes(1);
  });

  it("installs window.arweaveWallet with walletName 'Gleam' when none exists", () => {
    teardown = install();
    expect(current()?.walletName).toBe("Gleam");
  });

  it("exposes the walletVersion it was given", () => {
    teardown = install();
    expect(current()?.walletVersion).toBe(VERSION);
  });

  function listen(event: string) {
    const listener = vi.fn();
    window.addEventListener(event, listener);
    listeners.push([event, listener]);
    return listener;
  }

  it("announces Gleam with arweaveWalletLoaded only once other wallets have had the chance to install", async () => {
    vi.useFakeTimers();
    const onLoaded = listen("arweaveWalletLoaded");
    teardown = install();
    expect(onLoaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("announces window.gleam with gleamWalletLoaded straight away", () => {
    const onGleam = listen("gleamWalletLoaded");
    teardown = install();
    expect(onGleam).toHaveBeenCalledTimes(1);
  });

  it("waits for DOMContentLoaded before settling on a page that is still loading", async () => {
    vi.useFakeTimers();
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    try {
      const onLoaded = listen("arweaveWalletLoaded");
      teardown = install();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onLoaded).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("DOMContentLoaded"));
      await vi.advanceTimersByTimeAsync(150);
      expect(onLoaded).toHaveBeenCalledTimes(1);
    } finally {
      readyState.mockRestore();
    }
  });

  it("calls Gleam once no other wallet has shown up", async () => {
    vi.useFakeTimers();
    teardown = install();
    void current()!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(gleamRequests()).toHaveLength(1);
    void current()!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(2);
  });

  it("forwards a call made before a later wallet installs to that wallet", async () => {
    vi.useFakeTimers();
    teardown = install();
    const pending = current()!.connect!(["ACCESS_ADDRESS"]);

    const other = wander();
    (window as unknown as { arweaveWallet: unknown }).arweaveWallet = other;
    sendSiteMode(false);

    await expect(pending).resolves.toBe("wander-connected");
    expect(gleamRequests()).toHaveLength(0);
  });

  it("announces a wallet that installed first straight away", () => {
    installOther(wander());
    const onLoaded = listen("arweaveWalletLoaded");
    teardown = install();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("doesn't announce again a later wallet that announced itself", async () => {
    vi.useFakeTimers();
    teardown = install();
    const onLoaded = listen("arweaveWalletLoaded");
    installOther(wander());
    window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
    await vi.advanceTimersByTimeAsync(150);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("forwards to a wallet installed first once the site turns out not to use Gleam", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    expect(current()?.walletName).toBe("Wander");

    const pending = current()!.connect!(["ACCESS_ADDRESS"]);
    expect(other.connect).not.toHaveBeenCalled();
    sendSiteMode(false);

    await expect(pending).resolves.toBe("wander-connected");
    expect(other.connect).toHaveBeenCalledWith(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(0);
  });

  it("calls the other wallet with itself as this", async () => {
    const other = {
      walletName: "Wander",
      connect(this: unknown) {
        return Promise.resolve(this === other);
      },
    };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    await expect(current()!.connect!()).resolves.toBe(true);
  });

  it("uses Gleam on a site that holds a grant, even with another wallet installed", async () => {
    const other = wander();
    installOther(other, false);
    teardown = install();
    sendSiteMode(true);

    expect(current()?.walletName).toBe("Gleam");
    void current()!.connect!();
    await vi.waitFor(() => expect(gleamRequests()).toHaveLength(1));
    expect(other.connect).not.toHaveBeenCalled();
  });

  it("falls back to the other wallet when the site mode never arrives", async () => {
    vi.useFakeTimers();
    const other = wander();
    installOther(other);
    teardown = install();

    const pending = current()!.connect!();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(other.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("wander-connected");
  });

  const modeRequests = () => fake.modeRequests();

  it("never asks for the site mode on a page where Gleam is the only wallet", async () => {
    vi.useFakeTimers();
    teardown = install();
    void current()!.connect!();
    await vi.advanceTimersByTimeAsync(150);
    expect(modeRequests()).toBe(0);
  });

  it("announces PermawebOS when it loads after the page settled on Gleam", async () => {
    vi.useFakeTimers();
    teardown = install();
    await vi.advanceTimersByTimeAsync(150);
    const onLoaded = listen("arweaveWalletLoaded");
    permawebOS();
    window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
    window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(modeRequests()).toBe(1);
  });

  it("asks for the site mode once, as soon as another wallet shows up", () => {
    installOther(wander());
    teardown = install();
    void current()!.connect!();
    expect(modeRequests()).toBe(1);
  });

  it("enumerates the other wallet's own properties through the router", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);

    expect(Object.keys(current()!)).toEqual(Object.keys(other));
    expect(Object.prototype.hasOwnProperty.call(current(), "connect")).toBe(true);
    expect({ ...current() }.walletName).toBe("Wander");
  });

  it("routes a cached method to whichever wallet the site uses at call time", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    const connect = current()!.connect!;

    await connect();
    expect(other.connect).toHaveBeenCalledTimes(1);

    sendSiteMode(true);
    void connect();
    expect(other.connect).toHaveBeenCalledTimes(1);
    expect(gleamRequests()).toHaveLength(1);
  });

  it("reports the other wallet once on sight and once on first use", async () => {
    installOther(wander());
    teardown = install();
    sendSiteMode(false);
    await current()!.connect!();
    await current()!.connect!();

    expect(otherWalletReports()).toEqual([
      { walletName: "Wander", used: false },
      { walletName: "Wander", used: true },
    ]);
  });

  it("reports the permissions the page asks the other wallet for, or reads from it", async () => {
    const other = { ...wander(), getPermissions: vi.fn().mockResolvedValue(["ACCESS_ADDRESS"]) };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    await expect((current()!.getPermissions as () => Promise<unknown>)()).resolves.toEqual(["ACCESS_ADDRESS"]);
    await current()!.connect!(["ACCESS_ADDRESS", "SIGNATURE"], { name: "ArDrive" });
    await current()!.connect!(["ACCESS_ADDRESS", "SIGNATURE"]);

    expect(otherWalletReports().filter((report: object) => "permissions" in report)).toEqual([
      { walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] },
      { walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS", "SIGNATURE"] },
    ]);
  });

  it("doesn't count a call outside the wallet API as use", () => {
    const other = { ...wander(), helper: vi.fn() };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    String(current());
    (current() as unknown as { helper: () => void }).helper();
    Object.prototype.hasOwnProperty.call(current(), "connect");
    current()!.valueOf();

    expect(otherWalletReports()).toEqual([{ walletName: "Wander", used: false }]);
  });

  it("offers Gleam's methods before the site mode is known, and calls them on Gleam if the site uses it", async () => {
    const other = wander();
    installOther(other);
    teardown = install();

    expect(current()?.walletName).toBe("Wander");
    expect("signMessage" in current()!).toBe(true);
    expect(typeof current()!.signMessage).toBe("function");

    const signMessage = current()!.signMessage as () => Promise<unknown>;
    void signMessage();
    expect(gleamRequests()).toHaveLength(0);
    sendSiteMode(true);
    await vi.waitFor(() => expect(gleamRequests()).toHaveLength(1));
    expect(current()?.walletName).toBe("Gleam");
  });

  it("rejects a held call the site's wallet turns out not to have", async () => {
    installOther(wander());
    teardown = install();
    const pending = (current()!.signMessage as () => Promise<unknown>)();
    sendSiteMode(false);

    await expect(pending).rejects.toThrow(TypeError);
    expect("signMessage" in current()!).toBe(false);
    expect(current()!.signMessage).toBeUndefined();
    expect(gleamRequests()).toHaveLength(0);
  });

  it("passes non-function properties of the other wallet through", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    expect(current()?.events).toBe(other.events);
    expect("connect" in current()!).toBe(true);
  });

  it("captures a wallet that assigns the slot later, without throwing in strict mode", async () => {
    teardown = install();
    sendSiteMode(false);
    const other = wander();
    expect(() => {
      (window as unknown as { arweaveWallet: unknown }).arweaveWallet = other;
    }).not.toThrow();

    expect(current()?.walletName).toBe("Wander");
    await current()!.connect!();
    expect(other.connect).toHaveBeenCalled();
  });

  it("keeps the slot and forwards to a wallet that redefines it and announces arweaveWalletLoaded", async () => {
    teardown = install();
    sendSiteMode(false);
    const router = current();

    const other = wander();
    installOther(other);
    window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));

    expect(current()).toBe(router);
    await current()!.connect!();
    expect(other.connect).toHaveBeenCalled();
  });

  // As PermawebOS's injected.js installs it: defined unconditionally,
  // configurable and read-only.
  function permawebOS() {
    const permaweb = { walletName: "ArConnect", connect: vi.fn().mockResolvedValue("permaweb-connected") };
    Object.defineProperty(window, "permawebConnect", { value: permaweb, configurable: true, writable: false });
    return permaweb;
  }

  function permawebSlot(): Wallet & { events: { on: (...args: unknown[]) => void; off: (...args: unknown[]) => void } } {
    return (window as unknown as { permawebConnect: never }).permawebConnect;
  }

  // The check PermawebOS's dApp SDK (`assets/index-*.js`, `Q`) runs before
  // its connect button uses `window.permawebConnect`.
  function passesPermawebDetection(value: unknown): boolean {
    const wallet = value as Record<string, unknown> & { events?: Record<string, unknown> };
    return (
      typeof wallet === "object" &&
      typeof wallet.walletVersion === "string" &&
      typeof wallet.events?.on === "function" &&
      typeof wallet.events?.off === "function" &&
      [
        "connect", "disconnect", "getPermissions", "getActiveAddress", "getActivePublicKey", "getAllAddresses",
        "getWalletNames", "getArweaveConfig", "signMessage", "verifyMessage", "signature", "privateHash",
        "encrypt", "decrypt", "signDataItem", "batchSignDataItem", "sign", "dispatch",
      ].every((name) => typeof wallet[name] === "function")
    );
  }

  describe("window.permawebConnect when PermawebOS isn't installed", () => {
    it("fills the empty slot with a Gleam shim PermawebOS's SDK accepts", () => {
      teardown = install();
      const shim = permawebSlot();
      expect(passesPermawebDetection(shim)).toBe(true);
      expect(shim.walletName).toBe("Gleam");
      expect(shim.walletVersion).toBe(VERSION);
    });

    it("sends the connect button's calls to Gleam with their arguments", async () => {
      vi.useFakeTimers();
      teardown = install();
      void permawebSlot().connect!(["ACCESS_ADDRESS", "SIGNATURE"], { name: "Bazar" });
      void (permawebSlot().getActivePublicKey as () => Promise<unknown>)();
      // Held, like the router's calls, until other wallets have had the chance to install.
      expect(gleamRequests()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(150);
      const sent = gleamRequests();
      expect(sent.map((request) => request.method)).toEqual(["connect", "getActivePublicKey"]);
      expect(sent[0]!.params).toMatchObject({ permissions: ["ACCESS_ADDRESS", "SIGNATURE"], appInfo: { name: "Bazar" } });
    });

    it("isn't taken for another wallet, so a Gleam-only page never asks for the site mode", async () => {
      vi.useFakeTimers();
      teardown = install();
      void current()!.connect!();
      await vi.advanceTimersByTimeAsync(150);
      expect(modeRequests()).toBe(0);
      expect(otherWalletReports()).toHaveLength(0);
      expect(gleamRequests()).toHaveLength(1);
    });

    it("refuses, without a Gleam prompt, on a site the user left on another wallet", async () => {
      const other = wander();
      installOther(other);
      teardown = install();
      const pending = permawebSlot().connect!(["ACCESS_ADDRESS"]) as Promise<unknown>;
      expect(modeRequests()).toBe(1);
      sendSiteMode(false);

      await expect(pending).rejects.toThrow("This site uses another wallet.");
      expect(gleamRequests()).toHaveLength(0);
      expect(other.connect).not.toHaveBeenCalled();
    });

    it("answers through Gleam once the user picked Gleam for a site that also has another wallet", async () => {
      installOther(wander());
      teardown = install();
      const pending = permawebSlot().connect!(["ACCESS_ADDRESS"]) as Promise<unknown>;
      sendSiteMode(true);
      await vi.waitFor(() => expect(gleamRequests()).toHaveLength(1));
      void pending.catch(() => undefined);
    });

    it("leaves a slot PermawebOS already filled", () => {
      const permaweb = permawebOS();
      teardown = install();
      expect(permawebSlot()).toBe(permaweb);
    });

    it("announces the shim with permawebConnectLoaded once other wallets have had the chance to install", async () => {
      vi.useFakeTimers();
      const onLoaded = listen("permawebConnectLoaded");
      teardown = install();
      expect(onLoaded).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(150);
      expect(onLoaded).toHaveBeenCalledTimes(1);
      expect(listen("arweaveWalletLoaded")).not.toHaveBeenCalled();
    });

    it("doesn't announce the shim when PermawebOS took the slot before the settle", async () => {
      vi.useFakeTimers();
      const onLoaded = listen("permawebConnectLoaded");
      teardown = install();
      permawebOS();
      await vi.advanceTimersByTimeAsync(150);
      expect(onLoaded).not.toHaveBeenCalled();
    });

    it("hands the slot to PermawebOS when it loads, and the router then forwards to it", async () => {
      teardown = install();
      const permaweb = permawebOS();
      window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
      expect(permawebSlot()).toBe(permaweb);
      sendSiteMode(false);
      await expect(current()!.connect!()).resolves.toBe("permaweb-connected");
      expect(gleamRequests()).toHaveLength(0);
    });

    // What `GleamProvider` dispatches for a pushed event.
    function pushEvent(event: string, data: unknown): void {
      window.dispatchEvent(new CustomEvent(event, { detail: data }));
    }

    it("feeds the SDK's connect, disconnect and activeAddress listeners from Gleam's events, until removed", () => {
      teardown = install();
      const { events } = permawebSlot();
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      const onAddress = vi.fn();
      const onPermissions = vi.fn();
      events.on("connect", onConnect);
      events.on("disconnect", onDisconnect);
      events.on("activeAddress", onAddress);
      events.on("permissions", onPermissions);

      pushEvent("connect", { activeAddress: "addr-1" });
      pushEvent("walletSwitch", { address: "addr-2" });
      pushEvent("disconnect", {});
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onAddress.mock.calls).toEqual([["addr-1"], ["addr-2"]]);
      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(onPermissions).not.toHaveBeenCalled();

      events.off("connect", onConnect);
      events.off("activeAddress", onAddress);
      pushEvent("connect", { activeAddress: "addr-3" });
      pushEvent("walletSwitch", { address: "addr-4" });
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onAddress).toHaveBeenCalledTimes(2);
    });

    it("can't be swapped out by assignment", () => {
      teardown = install();
      const shim = permawebSlot();
      expect(() => {
        (window as unknown as { permawebConnect: unknown }).permawebConnect = { walletName: "Imposter" };
      }).toThrow();
      expect(permawebSlot()).toBe(shim);
    });
  });

  it("finds PermawebOS at window.permawebConnect when it skipped the taken slot, and announces it", async () => {
    vi.useFakeTimers();
    teardown = install();
    const onLoaded = listen("arweaveWalletLoaded");
    const pending = current()!.connect!();
    permawebOS();
    await vi.advanceTimersByTimeAsync(150);
    expect(modeRequests()).toBe(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    sendSiteMode(false);

    await expect(pending).resolves.toBe("permaweb-connected");
    expect(gleamRequests()).toHaveLength(0);
    expect(otherWalletReports()).toEqual([
      { walletName: "PermawebOS", used: false },
      { walletName: "PermawebOS", used: true },
    ]);
  });

  it("exposes Gleam at window.gleam, which reaches Gleam even while the site uses another wallet", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);

    const gleam = (window as unknown as { gleam?: Wallet }).gleam;
    expect(gleam?.walletName).toBe("Gleam");
    void gleam!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(1);
    expect(other.connect).not.toHaveBeenCalled();
  });

  it("keeps window.gleam from being replaced by assignment", () => {
    teardown = install();
    const gleam = (window as unknown as { gleam?: unknown }).gleam;
    expect(() => {
      (window as unknown as { gleam: unknown }).gleam = { walletName: "Imposter" };
    }).toThrow();
    expect((window as unknown as { gleam?: unknown }).gleam).toBe(gleam);
  });

  it("stops answering the site mode after teardown", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    const pending = current()!.connect!();
    teardown();
    teardown = undefined;
    fake.siteMode(true);
    let settled = false;
    void Promise.resolve(pending).then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
  });

  it("leaves a non-configurable provider alone instead of throwing", () => {
    installOther({ walletName: "Wander" });
    const onLoaded = vi.fn();
    const realDefineProperty = Object.defineProperty;
    const defineProperty = vi
      .spyOn(Object, "defineProperty")
      .mockImplementation((target, key, descriptor) => {
        if (key === "arweaveWallet") {
          throw new TypeError("Cannot redefine property: arweaveWallet");
        }
        return realDefineProperty(target, key, descriptor);
      });
    window.addEventListener("arweaveWalletLoaded", onLoaded);
    try {
      expect(() => {
        teardown = install();
      }).not.toThrow();
      expect(current()?.walletName).toBe("Wander");
      expect(onLoaded).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("arweaveWalletLoaded", onLoaded);
      defineProperty.mockRestore();
    }
  });
});
