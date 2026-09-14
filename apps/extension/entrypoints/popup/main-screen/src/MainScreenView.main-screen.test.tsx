import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type {
  ActivityPage,
  PortfolioHistory,
  RuntimePort,
  TokenBalance,
  WalletSummary,
  Winston,
} from "@gleam/core";
import { MainScreenView } from "./MainScreenView";

afterEach(() => {
  cleanup();
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

function successfulSend(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getBalance") return BALANCE;
    if (type === "getTokenBalances") return NO_TOKENS;
    if (type === "getActivity") return EMPTY_ACTIVITY;
    if (type === "getThemePreference") return overrides.themePreference ?? { theme: "light" };
    if (type === "setThemePreference") return undefined;
    if (type === "getPortfolioHistory") return overrides.portfolioHistory ?? PORTFOLIO_HISTORY_7D;
    throw new Error(`Unexpected message type "${type}"`);
  });
}

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
};

const EMPTY_ACTIVITY: ActivityPage = { entries: [], nextCursor: null };
const NO_TOKENS: TokenBalance[] = [];
const BALANCE: Winston = "1000000000000";

const PORTFOLIO_HISTORY_7D: PortfolioHistory = {
  range: "7D",
  series: [
    { timestamp: 1000, usdValue: 10 },
    { timestamp: 2000, usdValue: 12 },
  ],
  currentUsdValue: 12,
  usdChange: 0.2,
  periodLabel: "Last 7 days",
};

function renderMainScreen(overrides: Partial<Parameters<typeof MainScreenView>[0]> = {}) {
  return render(
    <MainScreenView
      runtime={fakeRuntime()}
      wallet={WALLET}
      onSend={vi.fn()}
      onReceive={vi.fn()}
      onViewAllTokens={vi.fn()}
      onViewAllActivity={vi.fn()}
      onOpenWalletSwitcher={vi.fn()}
      onOpenLockSettings={vi.fn()}
      onOpenNetworkPeers={vi.fn()}
      {...overrides}
    />,
  );
}

describe("MainScreenView navigation (settings-screens-gap)", () => {
  it("calls onOpenWalletSwitcher when the account pill is pressed", async () => {
    const send = successfulSend();
    const onOpenWalletSwitcher = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenWalletSwitcher });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Wallet One, address/i }));

    expect(onOpenWalletSwitcher).toHaveBeenCalled();
  });

  it("opens a settings menu with Lock & auto-lock and Network & peers entries", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("menuitem", { name: /Lock/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Network/i })).toBeTruthy();
  });

  it("calls onOpenLockSettings when the Lock & auto-lock menu item is pressed", async () => {
    const send = successfulSend();
    const onOpenLockSettings = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenLockSettings });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Lock/i }));

    expect(onOpenLockSettings).toHaveBeenCalled();
  });

  it("calls onOpenNetworkPeers when the Network & peers menu item is pressed", async () => {
    const send = successfulSend();
    const onOpenNetworkPeers = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenNetworkPeers });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Network/i }));

    expect(onOpenNetworkPeers).toHaveBeenCalled();
  });

  it("shows the network error banner and skeleton rows already established for this screen", async () => {
    const send = vi.fn().mockRejectedValue(new Error("unreachable"));
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    // Both the balance/activity load and the portfolio-history load fail
    // here (the same rejecting `send`), so two `NetworkErrorBanner`s render
    // — one per independent failure, matching this screen's existing
    // per-section error-banner pattern rather than a single shared one.
    await waitFor(() =>
      expect(screen.getAllByText(/couldn't reach the network/i).length).toBeGreaterThan(0),
    );
  });
});

describe("MainScreenView account avatar (main-screen-chart-wallet-core)", () => {
  it("renders a locally-generated SVG avatar in the account pill, with no network fetch to any dicebear host", async () => {
    const send = successfulSend();
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(originalFetch);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      renderMainScreen({ runtime: fakeRuntime({ send }) });

      await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
      const pill = screen.getByRole("button", { name: /Wallet One, address/i });
      const avatar = within(pill).getByRole("img", { name: /avatar/i });
      expect(avatar.querySelector("svg")).toBeTruthy();

      for (const call of fetchSpy.mock.calls) {
        const url = String(call[0]);
        expect(url).not.toMatch(/dicebear/i);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("renders a different avatar markup for a different wallet address", async () => {
    const send = successfulSend();
    const { unmount } = renderMainScreen({ runtime: fakeRuntime({ send }) });
    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    const firstPill = screen.getByRole("button", { name: /Wallet One, address/i });
    const firstSvg = within(firstPill).getByRole("img", { name: /avatar/i }).innerHTML;
    unmount();

    const otherWallet: WalletSummary = { ...WALLET, address: "zZ9y8x7w6v5u4t3s2r1qP0oN9mL8kJ7iH6gF5eD" };
    renderMainScreen({ runtime: fakeRuntime({ send: successfulSend() }), wallet: otherWallet });
    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    const secondPill = screen.getByRole("button", { name: /Wallet One, address/i });
    const secondSvg = within(secondPill).getByRole("img", { name: /avatar/i }).innerHTML;

    expect(secondSvg).not.toBe(firstSvg);
  });
});

describe("MainScreenView portfolio chart (main-screen-chart-wallet-core)", () => {
  it("fetches getPortfolioHistory for the default 7D range and renders value/%-change/period label together", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D" } }),
    );
    await waitFor(() => expect(screen.getByText("Last 7 days")).toBeTruthy());
    expect(screen.getByText("+20.00%")).toBeTruthy();
    expect(screen.getByText("$12.00")).toBeTruthy();

    // Gain color must reference the real `--color-positive` token, the
    // same token `ActivityRow`/`AddressDisplay` already use elsewhere.
    expect(screen.getByText("+20.00%").style.color).toBe("var(--color-positive)");
  });

  it("shows all 5 range tabs with 7D active by default", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Last 7 days")).toBeTruthy());
    for (const label of ["24H", "7D", "1M", "1Y", "ALL"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "7D" }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a range tab re-fetches that range and updates chart/%-change/period label together", async () => {
    const oneMonthHistory: PortfolioHistory = {
      range: "1M",
      series: [
        { timestamp: 500, usdValue: 100 },
        { timestamp: 1500, usdValue: 80 },
      ],
      currentUsdValue: 80,
      usdChange: -0.2,
      periodLabel: "Last 30 days",
    };
    const send = vi.fn(async ({ type, payload }: { type: string; payload?: unknown }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "setThemePreference") return undefined;
      if (type === "getPortfolioHistory") {
        const range = (payload as { range: string }).range;
        return range === "1M" ? oneMonthHistory : PORTFOLIO_HISTORY_7D;
      }
      throw new Error(`Unexpected message type "${type}"`);
    });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Last 7 days")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "1M" }));

    await waitFor(() => expect(screen.getByText("Last 30 days")).toBeTruthy());
    expect(screen.getByText("-20.00%")).toBeTruthy();
    expect(screen.getByText("$80.00")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "1M" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "7D" }).getAttribute("aria-selected")).toBe("false");

    // Decline color must reference the real `--color-negative` token
    // (theme.css's `@theme` block), never a hardcoded/browser-default
    // fallback like `red` and never the identity-only `--color-beam-red`.
    const badge = screen.getByText("-20.00%");
    expect(badge.style.color).toBe("var(--color-negative)");
  });

  it("shows NetworkErrorBanner (not a broken/blank chart) when getPortfolioHistory fails", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "setThemePreference") return undefined;
      if (type === "getPortfolioHistory") throw new Error("unreachable");
      throw new Error(`Unexpected message type "${type}"`);
    });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText(/couldn't reach the network/i).length).toBeGreaterThan(0));
  });
});

describe("MainScreenView theme toggle (theme-preference)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows the toggle unchecked when the stored preference is light", async () => {
    const send = successfulSend({ themePreference: { theme: "light" } });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }).getAttribute("aria-checked")).toBe(
        "false",
      ),
    );
  });

  it("shows the toggle checked when the stored preference is dark", async () => {
    const send = successfulSend({ themePreference: { theme: "dark" } });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
  });

  it("flipping the toggle persists via setThemePreference and applies data-theme immediately", async () => {
    const send = successfulSend({ themePreference: { theme: "light" } });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }).getAttribute("aria-checked")).toBe(
        "false",
      ),
    );

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }));

    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "setThemePreference", payload: { theme: "dark" } }),
    );
  });

  it("reverts the toggle and data-theme if setThemePreference fails", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "setThemePreference") throw new Error("write failed");
      throw new Error(`Unexpected message type "${type}"`);
    });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }).getAttribute("aria-checked")).toBe(
        "false",
      ),
    );

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }));

    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: /Dark mode/i }).getAttribute("aria-checked")).toBe(
        "false",
      ),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
