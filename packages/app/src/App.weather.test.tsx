import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RuntimePort, ThemeSettings, WalletState } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import App from "./App";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

const STATE = {
  wallets: [{ id: "w1", address: "a".repeat(43), name: "Main", method: "jwk", publicKey: "pk", createdAt: 0, updatedAt: 0, backupConfirmedAt: Date.now() }],
  activeWalletId: "w1",
  session: { unlockedWalletIds: ["w1"], unlockedAt: 0, lastActivityAt: 0 },
} as unknown as WalletState;

async function renderApp(theme: ThemeSettings, change: number) {
  const runtime: RuntimePort = {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return STATE;
      if (type === "getThemePreference") return theme;
      if (type === "getDisplaySettings") return { currency: "USD", headline: "total", header: "full", tokenLogos: true, tokenRows: "detailed", balancesHidden: false };
      if (type === "getBalance") return "0";
      if (type === "getTokenBalances") return [];
      if (type === "getActivity") return { entries: [] };
      if (type === "getTokenPrices") return [];
      if (type === "getPortfolioHistory") return { range: "7D", series: [{ timestamp: 0, value: 10 }, { timestamp: 1, value: 9 }], currentValue: 9, change, periodLabel: "Last 7 days" };
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
  await act(async () => {
    render(<App layout="popup" />, fakeAppPlatform({ runtime }));
  });
  await screen.findByRole("button", { name: "Receive" });
}

const market = () => screen.getByTestId("sky").getAttribute("data-market");

describe("App weather", () => {
  it.each([
    [-0.1617, "down"],
    [0.1482, "up"],
  ])("draws a change of %s as %s on home, and keeps it out of Receive", async (change, expected) => {
    await renderApp({ theme: "silica", weather: true }, change);
    await waitFor(() => expect(market()).toBe(expected));
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(market()).toBe("flat"));
  });

  it("stays clear with weather off", async () => {
    await renderApp({ theme: "silica" }, -0.1617);
    await screen.findByText("-16.17%");
    expect(market()).toBe("flat");
  });

  it("draws no sky outside silica", async () => {
    await renderApp({ theme: "dark", weather: true }, -0.1617);
    expect(screen.queryByTestId("sky")).toBeNull();
  });
});
