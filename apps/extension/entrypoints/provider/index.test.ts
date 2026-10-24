import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST } from "@gleam/messaging/src/page-protocol.ts";
import provider from "./index";
import { version as PACKAGE_VERSION } from "../../package.json";

describe("provider.js", () => {
  let addListenerSpy: ReturnType<typeof vi.spyOn>;
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addListenerSpy = vi.spyOn(window, "addEventListener");
    postMessageSpy = vi.spyOn(window, "postMessage");
  });

  afterEach(() => {
    for (const [type, listener] of addListenerSpy.mock.calls) {
      window.removeEventListener(type as string, listener as EventListener);
    }
    addListenerSpy.mockRestore();
    postMessageSpy.mockRestore();
    vi.useRealTimers();
    for (const name of ["arweaveWallet", "permawebConnect", "gleam"]) {
      delete (window as unknown as Record<string, unknown>)[name];
    }
  });

  type Wallet = { walletName?: string; walletVersion?: string; getActiveAddress: () => Promise<unknown> };
  const gleam = () => (window as unknown as { gleam: Wallet }).gleam;

  it("installs Gleam with the extension's own version", () => {
    provider.main();
    expect((window as unknown as { arweaveWallet: Wallet }).arweaveWallet.walletName).toBe("Gleam");
    expect(gleam().walletVersion).toBe(PACKAGE_VERSION);
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  // dApps compare walletVersion against Wander's version numbers. ArDrive
  // refuses anything below 1.26.0.
  it("keeps walletVersion at or above the Wander version dApps require", () => {
    const [major, minor] = PACKAGE_VERSION.split(".").map(Number);
    expect(major! > 1 || (major === 1 && minor! >= 26)).toBe(true);
  });

  it("sends calls to the content script as page envelopes", () => {
    provider.main();
    void gleam().getActiveAddress();
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: REQUEST, method: "getActiveAddress", params: {} }),
      location.origin,
    );
  });
});
