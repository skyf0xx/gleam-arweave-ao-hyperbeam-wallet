import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { fakeAppPlatform, memoryQueryCache, renderWithPlatform as render } from "./app-platform/testing";
import App from "./App";

afterEach(() => {
  cleanup();
});

function wallet(id: string, name: string, address: string): WalletSummary {
  return { id, address, name, method: "jwk", publicKey: "pk", createdAt: 0, updatedAt: 0, backupConfirmedAt: Date.now() } as WalletSummary;
}

const MAIN = wallet("w1", "Main", "a".repeat(43));
const SECOND = wallet("w2", "Second", "b".repeat(43));

function unlockedState(wallets: WalletSummary[]): WalletState {
  return {
    wallets,
    activeWalletId: "w1",
    session: { unlockedWalletIds: wallets.map((entry) => entry.id), unlockedAt: 0, lastActivityAt: 0 },
  } as unknown as WalletState;
}

/** Answers the main screen's reads; anything in `pending` never resolves, as if the network were slow. */
function runtimeFor(getState: () => WalletState, handlers: Record<string, () => unknown> = {}, pending: string[] = []): RuntimePort {
  return {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (pending.includes(type)) return new Promise(() => {});
      if (type in handlers) return handlers[type]!();
      if (type === "getState") return getState();
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "getDisplaySettings") return { currency: "USD", headline: "total", compactHeader: false, showTokenLogos: false, balancesHidden: false };
      if (type === "getBalance") return "0";
      if (type === "getTokenBalances") return [];
      if (type === "getActivity") return { entries: [] };
      if (type === "getTokenPrices") return [];
      if (type === "getPortfolioHistory") return { range: "7D", series: [{ timestamp: 0, value: 0 }], currentValue: 0, change: 0, periodLabel: "Last 7 days" };
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
}

function storedCache(address: string): string {
  const source = new QueryClient();
  const updatedAt = Date.now() - 60_000;
  source.setQueryData([address, "balances"], { arBalance: "2500000000000", tokenBalances: [] }, { updatedAt });
  source.setQueryData([address, "activity"], { entries: [] }, { updatedAt });
  const persisted: PersistedClient = { buster: "1.2.3", timestamp: Date.now(), clientState: dehydrate(source) };
  return JSON.stringify(persisted);
}

describe("App query cache", () => {
  it("shows the stored balances on the main screen instead of skeletons while they're read again", async () => {
    const cache = memoryQueryCache(new Map([["w1", storedCache(MAIN.address)]]));
    const runtime = runtimeFor(() => unlockedState([MAIN]), {}, ["getBalance", "getTokenBalances", "getActivity"]);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<App layout="popup" />, fakeAppPlatform({ runtime, queryCache: cache })));
    });

    expect(await screen.findByText("2.5")).toBeTruthy();
    const list = screen.getByRole("tablist", { name: "Tokens, collectibles and activity" }).nextElementSibling;
    expect(list?.querySelector(".gleam-shimmer")).toBeNull();
    expect(container.querySelector('[data-layout="popup"]')).toBeTruthy();
  });

  it("sweeps a stored cache for a wallet that's no longer in the vault once the list loads", async () => {
    const cache = memoryQueryCache(new Map([["w1", storedCache(MAIN.address)], ["gone", storedCache(SECOND.address)]]));
    await act(async () => {
      render(<App layout="popup" />, fakeAppPlatform({ runtime: runtimeFor(() => unlockedState([MAIN])), queryCache: cache }));
    });
    await vi.waitFor(() => expect(cache.entries.has("gone")).toBe(false));
    expect(cache.entries.has("w1")).toBe(true);
  });

  it("clears a removed wallet's cache and keeps the others", async () => {
    let wallets = [MAIN, SECOND];
    const cache = memoryQueryCache(new Map([["w1", storedCache(MAIN.address)], ["w2", storedCache(SECOND.address)]]));
    const runtime = runtimeFor(() => unlockedState(wallets), {
      deleteWallet: () => {
        wallets = [MAIN];
      },
    });
    await act(async () => {
      render(<App layout="popup" />, fakeAppPlatform({ runtime, queryCache: cache }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /view account details/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Manage Second" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Remove wallet" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Yes, remove wallet" }));
    });

    await vi.waitFor(() => expect(cache.entries.has("w2")).toBe(false));
    expect(cache.entries.has("w1")).toBe(true);
  });

  it("clears every cache when the wallets are reset", async () => {
    let state: WalletState = { ...unlockedState([MAIN, SECOND]), session: null } as unknown as WalletState;
    const cache = memoryQueryCache(new Map([["w1", storedCache(MAIN.address)], ["w2", storedCache(SECOND.address)]]));
    const runtime = runtimeFor(() => state, {
      resetAllWallets: () => {
        state = { wallets: [], activeWalletId: null, session: null } as unknown as WalletState;
      },
    });
    const get = vi.spyOn(cache, "get");
    await act(async () => {
      render(<App layout="popup" />, fakeAppPlatform({ runtime, queryCache: cache }));
    });
    expect(await screen.findByRole("button", { name: "Forgot password?" })).toBeTruthy();
    // Nothing is restored on the unlock screen.
    expect(get).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Forgot password?" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Reset wallet" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Yes, reset wallet" }));
    });

    await vi.waitFor(() => expect(cache.entries.size).toBe(0));
  });
});
