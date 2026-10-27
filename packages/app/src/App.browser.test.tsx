import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import type { DappBrowserPort } from "./app-platform/types";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wallet: WalletSummary = {
  id: "w1",
  address: "addr",
  name: "Main",
  method: "jwk",
  publicKey: "pk",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};
const unlocked = { wallets: [wallet], activeWalletId: "w1", session: { unlockedWalletIds: ["w1"] } } as unknown as WalletState;
const locked = { wallets: [wallet], activeWalletId: "w1", session: null } as unknown as WalletState;

function setup(dappBrowser: boolean) {
  let state = unlocked;
  const runtime: RuntimePort = {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return state;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "listBrowserSites") return { saved: [], recent: [] };
      if (type === "getPasskeyStatus") return { enrolled: false };
      if (type === "getBalance") return "0";
      if (type === "getTokenBalances" || type === "getConnectedApps") return [];
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
  const close = vi.fn(async () => {});
  const port: DappBrowserPort = {
    open: async () => {},
    close,
    goBack: async () => {},
    reload: async () => {},
    setFrame: async () => {},
    setHidden: async () => {},
    clearSiteData: async () => {},
    subscribe: () => () => {},
  };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  return {
    close,
    lock: () => {
      state = locked;
    },
    mount: () => act(async () => void render(<App layout="phone" />, fakeAppPlatform({ runtime, dappBrowser: port, capabilities: { dappBrowser } }))),
  };
}

describe("App browser", () => {
  it("opens the browser from the main screen when the host has one", async () => {
    await setup(true).mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    });
    expect(await screen.findByLabelText("Address")).toBeTruthy();
  });

  it("has no browser button where the host has none", async () => {
    await setup(false).mount();
    await screen.findByRole("button", { name: "Settings" });
    expect(screen.queryByRole("button", { name: "Browser" })).toBeNull();
  });

  it("closes the page and shows the lock screen when the wallet locks while browsing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const harness = setup(true);
    await harness.mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    });
    harness.lock();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(harness.close).toHaveBeenCalled();
    expect(screen.queryByLabelText("Address")).toBeNull();
    vi.useRealTimers();
  });
});
