import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ActivityPage,
  DisplaySettings,
  PortfolioHistory,
  RuntimePort,
  TokenBalance,
  TokenPrice,
  WalletSummary,
  Winston,
} from "@gleam/core";
import { AO_ICON_URL, AR_ICON_URL } from "@gleam/ui";
import { MainScreenView } from "./MainScreenView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

function successfulSend(overrides: Record<string, unknown> = {}): RuntimePort["send"] {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getBalance") return BALANCE;
    if (type === "getTokenBalances") return NO_TOKENS;
    if (type === "getActivity") return EMPTY_ACTIVITY;
    if (type === "getPortfolioHistory") return overrides.portfolioHistory ?? PORTFOLIO_HISTORY_7D;
    if (type === "getTokenPrices") return [];
    if (type === "getPointsMemberships") return {};
    if (type === "getState") return { wallets: overrides.wallets ?? [WALLET], activeWalletId: WALLET.id, session: null };
    if (type === "getNetworkSettings") {
      return overrides.networkSettings ?? { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
    }
    throw new Error(`Unexpected message type "${type}"`);
  }) as RuntimePort["send"];
}

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const EMPTY_ACTIVITY: ActivityPage = { entries: [], cursor: null };
const NO_TOKENS: TokenBalance[] = [];
const BALANCE: Winston = "1000000000000";

const PORTFOLIO_HISTORY_7D: PortfolioHistory = {
  range: "7D",
  series: [
    { timestamp: 1000, value: 10 },
    { timestamp: 2000, value: 12 },
  ],
  currentValue: 12,
  change: 0.2,
  periodLabel: "Last 7 days",
};

/**
 * `MainScreenView` reads shared balances/activity via `useBalances`/
 * `useActivity` (TanStack Query), which requires a `QueryClientProvider`
 * ancestor — mirrors `App.tsx`'s real wiring and `SendView.send.test.tsx`'s
 * own render helper. A fresh, `retry: false` `QueryClient` per render keeps
 * each test's cache isolated and makes a mocked `runtime.send` rejection
 * surface as this query's error state on the first attempt instead of
 * TanStack's default 3-retry backoff.
 */
function renderMainScreen(overrides: Partial<Parameters<typeof MainScreenView>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MainScreenView
        runtime={fakeRuntime()}
        wallet={WALLET}
        onSend={vi.fn()}
        onSendToken={vi.fn()}
        onReceive={vi.fn()}
        onOpenWalletSwitcher={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenPoints={vi.fn()}
        onUseGleamOnSite={vi.fn()}
        onOpenCollectible={vi.fn()}
        onAddToken={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
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

  it("calls onOpenSettings when the gear button is pressed", async () => {
    const send = successfulSend();
    const onOpenSettings = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenSettings });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("keeps a failed background load off the top bar", async () => {
    const send = vi.fn().mockRejectedValue(new Error("unreachable"));
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "getPortfolioHistory" })));
    await act(async () => {});
    expect(document.querySelector(".gleam-loading-sweep")).toBeNull();
    expect(screen.queryByText(/couldn't reach the network/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("MainScreenView: a watch-only wallet", () => {
  const WATCHED: WalletSummary = { ...WALLET, method: "watch", publicKey: "" };

  it("keeps Send visible but disabled and leaves Receive working", async () => {
    const onSend = vi.fn();
    const onReceive = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send: successfulSend({ wallets: [WATCHED] }) }), wallet: WATCHED, onSend, onReceive });

    const sendButton = await screen.findByRole("button", { name: "Send" });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(onReceive).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("enables Send for a keyfile wallet", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: successfulSend() }) });

    expect(((await screen.findByRole("button", { name: "Send" })) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/watch-only/)).toBeNull();
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
      expect(avatar.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);

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

describe("MainScreenView display settings", () => {
  function sendWithDisplay(settings: Partial<DisplaySettings>, prices: TokenPrice[] = []) {
    const base = successfulSend();
    const display: DisplaySettings = { currency: "USD", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: false, ...settings };
    return vi.fn(async (message: { type: string; payload: unknown }) => {
      if (message.type === "getDisplaySettings") return display;
      if (message.type === "setDisplaySettings") return undefined;
      if (message.type === "getTokenPrices") return prices;
      return base(message as never);
    }) as unknown as RuntimePort["send"] & ReturnType<typeof vi.fn>;
  }

  it("asks for prices and history in the chosen currency and formats them in it", async () => {
    const send = sendWithDisplay({ currency: "EUR" }, [{ processId: null, price: 3, change24h: null }]);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D", address: WALLET.address, scope: "wallet", currency: "EUR" } }),
    );
    expect(send).toHaveBeenCalledWith({ type: "getTokenPrices", payload: { currency: "EUR" } });
    const euros = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(value);
    await waitFor(() => expect(screen.getByText(euros(12))).toBeTruthy());
    await waitFor(() => expect(screen.getByText(euros(3))).toBeTruthy());
  });

  it("leads with the AR balance and keeps the total on a smaller line", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithDisplay({ headline: "AR" }) }) });

    await waitFor(() => expect(screen.getByRole("button", { name: "Hide balances" }).textContent).toBe("1 AR"));
    expect(screen.getByText("$12.00")).toBeTruthy();
  });

  it("keeps the chart, %-change and range tabs with the compact header on", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithDisplay({ header: "compact" }) }) });

    await waitFor(() => expect(screen.getByRole("img", { name: /Portfolio value/ })).toBeTruthy());
    expect(within(screen.getByRole("button", { name: "Hide balances" }).parentElement!).getByText("+20.00%")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "7D" })).toBeTruthy();
  });

  it("drops the chart and range tabs with the minimal header, naming the range beside the %-change", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithDisplay({ header: "minimal" }) }) });

    const figures = await waitFor(() => {
      const row = screen.getByRole("button", { name: "Hide balances" }).parentElement!;
      expect(within(row).getByText("+20.00%")).toBeTruthy();
      return row;
    });
    expect(within(figures).getByText("7D")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Portfolio value/ })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Chart range" })).toBeNull();
  });

  it("puts the total, change and range in the top bar once scrolled, and taps back to the top", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithDisplay({}) }) });
    await waitFor(() => expect(screen.getByText("$12.00")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "$12.00 +20.00% 7D" })).toBeNull();

    Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
    fireEvent.scroll(window);
    fireEvent.click(await screen.findByRole("button", { name: "$12.00 +20.00% 7D" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    scrollTo.mockRestore();
  });

  it("masks the top-bar total with the balances", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithDisplay({ balancesHidden: true }) }) });
    await screen.findByRole("button", { name: "Show balances" });

    Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
    fireEvent.scroll(window);

    expect(await screen.findByRole("button", { name: "•••••• +20.00% 7D" })).toBeTruthy();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("shows the unit price and 24h change on a token row, and hides the price with the balances", async () => {
    const send = sendWithDisplay({}, [{ processId: null, price: 3, change24h: -0.024 }]);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("-2.40%")).toBeTruthy());
    expect(screen.getByText(/@ \$3\.00/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide balances" }));
    await waitFor(() => expect(screen.queryByText(/@ \$3\.00/)).toBeNull());
  });

  it("leaves the unit price and 24h change off a token row with simple rows, keeping the value", async () => {
    const send = sendWithDisplay({ tokenRows: "simple" }, [{ processId: null, price: 3, change24h: -0.024 }]);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("$3.00")).toBeTruthy());
    expect(screen.queryByText("-2.40%")).toBeNull();
    expect(screen.queryByText(/@ \$3\.00/)).toBeNull();
  });

  it("hides every balance when the total is tapped, and saves the choice", async () => {
    const send = sendWithDisplay({}, [{ processId: null, price: 3, change24h: null }]);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("$3.00")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Hide balances" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Show balances" }).textContent).toBe("••••••"));
    expect(screen.queryByText("$12.00")).toBeNull();
    expect(screen.queryByText("$3.00")).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
    expect(send).toHaveBeenCalledWith({
      type: "setDisplaySettings",
      payload: { currency: "USD", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: true },
    });
  });
});

describe("MainScreenView portfolio chart (main-screen-chart-wallet-core)", () => {
  it("fetches getPortfolioHistory for the default 7D range and renders value and %-change together", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D", address: WALLET.address, scope: "wallet", currency: "USD" } }),
    );
    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    expect(screen.queryByText("Last 7 days")).toBeNull();
    expect(screen.getByText("$12.00")).toBeTruthy();

    // Gain color must reference the real `--color-positive` token, the
    // same token `ActivityRow`/`AddressDisplay` already use elsewhere.
    expect(screen.getByText("+20.00%").style.color).toBe("var(--color-positive)");
  });

  it("shows all 5 range tabs with 7D active by default", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    for (const label of ["24H", "7D", "1M", "1Y", "ALL"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "7D" }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking a range tab re-fetches that range and updates chart and %-change together", async () => {
    const oneMonthHistory: PortfolioHistory = {
      range: "1M",
      series: [
        { timestamp: 500, value: 100 },
        { timestamp: 1500, value: 80 },
      ],
      currentValue: 80,
      change: -0.2,
      periodLabel: "Last 30 days",
    };
    const send = vi.fn(async ({ type, payload }: { type: string; payload?: unknown }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") {
        const range = (payload as { range: string }).range;
        return range === "1M" ? oneMonthHistory : PORTFOLIO_HISTORY_7D;
      }
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "1M" }));

    await waitFor(() => expect(screen.getByText("-20.00%")).toBeTruthy());
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

  it("holds the chart and total on their shimmer, not a $0 total, when getPortfolioHistory fails", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") throw new Error("unreachable");
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    const { container } = renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "getPortfolioHistory" })));
    await act(async () => {});
    expect(container.querySelector(".gleam-shimmer")).toBeTruthy();
    expect(screen.getByTestId("figure-placeholder")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("formats a large %-change with thousands separators", async () => {
    const send = successfulSend({ portfolioHistory: { ...PORTFOLIO_HISTORY_7D, change: 27.6866 } });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+2,768.66%")).toBeTruthy());
  });

  it("offers no scope toggle with a single wallet", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Show all wallets" })).toBeNull();
  });

  it("clicking the chart with several wallets toggles to the all-wallets total and back", async () => {
    const otherWallet: WalletSummary = { ...WALLET, id: "wallet-2", address: "other-address", name: "Wallet Two" };
    const send = successfulSend({ wallets: [WALLET, otherWallet] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    fireEvent.click(await screen.findByRole("button", { name: "Show all wallets" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D", address: WALLET.address, scope: "all", currency: "USD" } }),
    );
    expect(screen.getByText("All wallets")).toBeTruthy();
    expect(window.localStorage.getItem("gleam:portfolioScope")).toBe("all");

    fireEvent.click(screen.getByRole("button", { name: "Show this wallet" }));
    expect(screen.getByText("This wallet")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show all wallets" }).getAttribute("aria-pressed")).toBe("false"),
    );
  });

  it("restores a saved all-wallets preference without first fetching the single-wallet view", async () => {
    window.localStorage.setItem("gleam:portfolioScope", "all");
    const otherWallet: WalletSummary = { ...WALLET, id: "wallet-2", address: "other-address", name: "Wallet Two" };
    const send = successfulSend({ wallets: [WALLET, otherWallet] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D", address: WALLET.address, scope: "all", currency: "USD" } }),
    );
    expect(screen.getByRole("button", { name: "Show this wallet" }).getAttribute("aria-pressed")).toBe("true");
    expect(send).not.toHaveBeenCalledWith({ type: "getPortfolioHistory", payload: { range: "7D", address: WALLET.address, scope: "wallet", currency: "USD" } });
  });
});

describe("MainScreenView chart range", () => {
  it("saves the picked range and opens on it next time", async () => {
    const send = successfulSend();
    const { unmount } = renderMainScreen({ runtime: fakeRuntime({ send }) });
    fireEvent.click(await screen.findByRole("tab", { name: "1M" }));
    expect(window.localStorage.getItem("gleam:portfolioRange")).toBe("1M");
    unmount();

    const reopened = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send: reopened }) });
    await waitFor(() => expect(screen.getByRole("tab", { name: "1M" }).getAttribute("aria-selected")).toBe("true"));
    expect(reopened).not.toHaveBeenCalledWith(expect.objectContaining({ type: "getPortfolioHistory", payload: expect.objectContaining({ range: "7D" }) }));
  });

  it("falls back to 7D for an unknown saved range", async () => {
    window.localStorage.setItem("gleam:portfolioRange", "5Y");
    renderMainScreen();
    await waitFor(() => expect(screen.getByRole("tab", { name: "7D" }).getAttribute("aria-selected")).toBe("true"));
  });
});

describe("MainScreenView token rows (AO-TOKEN-SEND-WALLET-CORE)", () => {
  const AO_TOKEN: TokenBalance = {
    address: WALLET.address,
    processId: "processABC",
    ticker: "PNTS",
    denomination: 0,
    name: null,
    quantity: "500",
  };

  it("calls onSendToken with the token when its row is clicked — every listed token is genuinely sendable", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [AO_TOKEN];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    const onSendToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onSendToken });

    await waitFor(() => expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /PNTS/ }));

    expect(onSendToken).toHaveBeenCalledWith(AO_TOKEN);
  });

  it("shows what can be spent with a note for what's pending, and passes that amount on to Send", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [AO_TOKEN];
      if (type === "getPendingTransfers") return [{ token: AO_TOKEN.processId, outgoing: "200", incoming: "50" }];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    const onSendToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onSendToken });

    const note = await screen.findByText("200 sending, +50 arriving");
    expect(note.parentElement?.textContent).toContain("300 ·");
    fireEvent.click(screen.getByRole("button", { name: /PNTS/ }));
    expect(onSendToken).toHaveBeenCalledWith(expect.objectContaining({ quantity: "300" }));
  });

  it("lists every row alphabetically by name, and opens Gleam Points on click", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [AO_TOKEN];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      if (type === "getPointsMemberships") return {};
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    const onOpenPoints = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenPoints });

    await waitFor(() => expect(screen.getByText("Sign up")).toBeTruthy());
    const rowNames = screen
      .getAllByText(/^(Arweave|AO|Gleam Points|PNTS)$/)
      .filter((element) => element.classList.contains("font-semibold"))
      .map((element) => element.textContent);
    expect(rowNames).toEqual(["AO", "Arweave", "Gleam Points", "PNTS"]);

    fireEvent.click(screen.getByRole("button", { name: /Gleam Points/ }));
    expect(onOpenPoints).toHaveBeenCalled();
  });

  it("formats a token's balance in its own denomination, not as a raw atomic-unit integer", async () => {
    const SCALED_TOKEN: TokenBalance = {
      address: WALLET.address,
      processId: "processXYZ",
      ticker: "USDC",
      denomination: 6,
      name: null,
      quantity: "1500000",
    };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [SCALED_TOKEN];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("1.5")).toBeTruthy());
    expect(screen.queryByText("1500000")).toBeNull();
  });
});

describe("MainScreenView hidden token rows", () => {
  const DISCOVERED: TokenBalance = {
    address: WALLET.address,
    processId: "processSPAM",
    ticker: "FREE",
    denomination: 0,
    name: null,
    quantity: "100",
    source: "discovered",
  };

  function sendWithTokens(tokens: TokenBalance[], display?: Partial<DisplaySettings>): RuntimePort["send"] {
    const base = successfulSend();
    return vi.fn(async (message: { type: string }) => {
      if (message.type === "getTokenBalances") return tokens;
      if (message.type === "getDisplaySettings" && display) {
        return { currency: "USD", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: false, ...display };
      }
      return base(message as never);
    }) as RuntimePort["send"];
  }

  it("files a discovered token under Hidden, with Show/Hide controls only while it's expanded", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([DISCOVERED]) }) });

    const toggle = await screen.findByRole("button", { name: "Hidden (1)" });
    expect(screen.queryByText("FREE")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Hide (?!balances)/ })).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByText("FREE")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show FREE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide Arweave" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide Gleam Points" })).toBeTruthy();
  });

  it("draws a discovered token's letters while it's hidden, and its logo once the user shows it", async () => {
    const logoUrl = `https://arweave.net/${"L".repeat(43)}`;
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([{ ...DISCOVERED, logoUrl }], { tokenLogos: true }) }) });
    const sources = () => Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));
    expect(screen.getByText("FREE")).toBeTruthy();
    expect(sources()).not.toContain(logoUrl);

    fireEvent.click(screen.getByRole("button", { name: "Show FREE" }));
    await waitFor(() => expect(sources()).toContain(logoUrl));
  });

  it("draws only letters, even for a shown token, while the Token logos setting is off", async () => {
    const logoUrl = `https://arweave.net/${"L".repeat(43)}`;
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([{ ...DISCOVERED, logoUrl }], { tokenLogos: false }) }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Show FREE" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Hide FREE" })).toBeTruthy());
    const sources = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(sources).not.toContain(logoUrl);
  });

  function setScrollY(value: number) {
    Object.defineProperty(window, "scrollY", { value, configurable: true });
    fireEvent.scroll(window);
  }

  afterEach(() => {
    setScrollY(0);
  });

  it("shows neither the Hidden accordion nor Edit list on the home screen when nothing is hidden", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }) });

    await screen.findByText("Gleam Points");
    expect(screen.queryByRole("button", { name: /^Hidden/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit list" })).toBeNull();
  });

  it("offers Edit list in the full token view, and hiding a row opens the accordion with it, remembered for the wallet", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const view = renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }) });

    await screen.findByText("Gleam Points");
    setScrollY(200);
    fireEvent.click(await screen.findByRole("button", { name: "Edit list" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Arweave" }));

    expect(screen.getByRole("button", { name: "Hidden (1)" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Show Arweave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit list" })).toBeNull();

    view.unmount();
    setScrollY(0);
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }) });

    await screen.findByRole("button", { name: "Hidden (1)" });
    expect(screen.queryByText("Arweave")).toBeNull();
    scrollTo.mockRestore();
  });

  it("offers Add a token as a row while editing the list, and only then", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const onAddToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }), onAddToken });

    await screen.findByText("Gleam Points");
    setScrollY(200);
    expect(screen.queryByRole("button", { name: /Add a token/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit list" }));
    fireEvent.click(screen.getByRole("button", { name: /Add a token/ }));

    expect(onAddToken).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    scrollTo.mockRestore();
  });

  it("brings the header back when the docked list is pulled past its top, by wheel or by touch", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }) });

    await screen.findByText("Gleam Points");
    setScrollY(200);
    const section = await waitFor(() => {
      const docked = document.querySelector<HTMLElement>(".gleam-dock-in");
      expect(docked).toBeTruthy();
      return docked!;
    });
    const home = () => scrollTo.mock.calls.filter(([options]) => (options as ScrollToOptions)?.top === 0).length;

    fireEvent.wheel(section, { deltaY: -20 });
    expect(home()).toBe(0);
    fireEvent.wheel(section, { deltaY: -20 });
    expect(home()).toBe(1);

    const at = (clientY: number, clientX = 50) => ({ touches: [{ clientX, clientY }] });
    fireEvent.touchStart(section, at(100));
    fireEvent.touchMove(section, at(120));
    expect(home()).toBe(1);
    expect(section.style.translate).toBe("0px 20px");
    fireEvent.touchMove(section, at(130));
    expect(home()).toBe(2);
    expect(section.style.translate).toBe("");

    // Sideways is a tab swipe, not a pull.
    fireEvent.touchStart(section, at(100));
    fireEvent.touchMove(section, at(110, 90));
    fireEvent.touchMove(section, at(160, 90));
    expect(home()).toBe(2);

    section.scrollTop = 50;
    fireEvent.wheel(section, { deltaY: -100 });
    expect(home()).toBe(2);

    // A scroll that reaches the top carries on into a pull, over a longer distance.
    fireEvent.touchStart(section, at(100));
    fireEvent.touchMove(section, at(140));
    section.scrollTop = 0;
    fireEvent.touchMove(section, at(150));
    fireEvent.touchMove(section, at(190));
    expect(home()).toBe(2);
    fireEvent.touchMove(section, at(200));
    expect(home()).toBe(3);

    // The tab row is a handle wherever the list is scrolled to.
    section.scrollTop = 50;
    const handle = screen.getByRole("tablist", { name: "Tokens, collectibles and activity" });
    fireEvent.touchStart(handle, at(100));
    fireEvent.touchMove(handle, at(130));
    expect(home()).toBe(4);
    scrollTo.mockRestore();
  });

  it("opens with the list in edit mode when coming back from Add a token", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }), initialTokenEditing: true });

    expect(await screen.findByRole("button", { name: /Add a token/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    scrollTo.mockRestore();
  });

  it("ignores a hidden token only after confirming, removing it from Hidden too", async () => {
    let tokens = [DISCOVERED];
    const base = successfulSend();
    const send = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === "getTokenBalances") return tokens;
      if (message.type === "removeWatchedToken") {
        tokens = [];
        return undefined;
      }
      return base(message as never);
    }) as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));

    expect(screen.getByText(/Ignored tokens leave Gleam/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel ignoring FREE" }));
    expect(screen.queryByText(/Ignored tokens leave Gleam/)).toBeNull();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "removeWatchedToken" }));

    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));

    await waitFor(() => expect(screen.queryByText("FREE")).toBeNull());
    expect(send).toHaveBeenCalledWith({
      type: "removeWatchedToken",
      payload: { address: WALLET.address, processId: DISCOVERED.processId },
    });
    expect(screen.queryByRole("button", { name: /^Hidden/ })).toBeNull();
  });

  it("drops an ignored row without waiting for balances to reload, and keeps several confirms open", async () => {
    const OTHER: TokenBalance = { ...DISCOVERED, processId: "processSPAM2", ticker: "SCAM" };
    const base = successfulSend();
    let balanceReads = 0;
    const send = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === "getTokenBalances") {
        balanceReads += 1;
        // Only the first read answers; a reload after ignoring never does.
        return balanceReads === 1 ? [DISCOVERED, OTHER] : new Promise<never>(() => {});
      }
      if (message.type === "removeWatchedToken") return undefined;
      return base(message as never);
    }) as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore SCAM" }));
    expect(screen.getByRole("button", { name: "Cancel ignoring FREE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel ignoring SCAM" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));
    await waitFor(() => expect(screen.queryByText("FREE")).toBeNull());
    expect(screen.getByRole("button", { name: "Cancel ignoring SCAM" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ignore SCAM" }));
    await waitFor(() => expect(screen.queryByText("SCAM")).toBeNull());
  });

  it("brings an ignored row back with an error when the write fails", async () => {
    const base = successfulSend();
    const send = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === "getTokenBalances") return [DISCOVERED];
      if (message.type === "removeWatchedToken") throw new Error("storage");
      return base(message as never);
    }) as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore FREE" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(await screen.findByText("FREE")).toBeTruthy();
  });

  it("offers no Ignore on a hidden default row", async () => {
    window.localStorage.setItem(`gleam:tokenVisibility:${WALLET.address}`, JSON.stringify({ "default-ar": "hidden" }));
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([]) }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));

    expect(screen.getByRole("button", { name: "Show Arweave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ignore Arweave" })).toBeNull();
  });

  it("drops the accordion once its last row is shown, leaving Done to leave Show/Hide", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWithTokens([DISCOVERED]) }) });

    fireEvent.click(await screen.findByRole("button", { name: "Hidden (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Show FREE" }));

    expect(screen.queryByRole("button", { name: /^Hidden/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Hide FREE" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Hide FREE" })).toBeNull();
  });
});

describe("MainScreenView default AR/AO token rows (DEFAULT-TOKEN-LIST-WALLET-CORE)", () => {
  const DEFAULT_AO_PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

  function sendWith(overrides: {
    arBalance?: Winston;
    tokenBalances?: TokenBalance[];
    tokenLogos?: boolean;
  }): RuntimePort["send"] {
    return vi.fn(async ({ type }: { type: string }) => {
      if (type === "getDisplaySettings" && overrides.tokenLogos !== undefined) {
        return { currency: "USD", header: "full", tokenLogos: overrides.tokenLogos, tokenRows: "detailed", headline: "total", balancesHidden: false };
      }
      if (type === "getBalance") return overrides.arBalance ?? BALANCE;
      if (type === "getTokenBalances") return overrides.tokenBalances ?? NO_TOKENS;
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
  }

  it("shows an AR row and an AO row reading 0 for a fresh wallet with no balances, never hitting the empty state", async () => {
    const send = sendWith({ arBalance: "0", tokenBalances: [] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Arweave")).toBeTruthy());
    expect(screen.getAllByText("AO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBe(2);
    expect(screen.queryByText(/Nothing here yet/i)).toBeNull();
  });

  it("renders the bundled AR and AO icons on the default rows when token logos are on", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWith({ arBalance: "0", tokenBalances: [], tokenLogos: true }) }) });

    await waitFor(() => expect(screen.getByText("Arweave")).toBeTruthy());
    await waitFor(() => {
      const sources = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
      expect(sources).toContain(AR_ICON_URL);
      expect(sources).toContain(AO_ICON_URL);
    });
  });

  it("draws letters on the default rows while token logos are off", async () => {
    renderMainScreen({ runtime: fakeRuntime({ send: sendWith({ arBalance: "0", tokenBalances: [], tokenLogos: false }) }) });

    await waitFor(() => expect(screen.getByText("Arweave")).toBeTruthy());
    const sources = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(sources).not.toContain(AR_ICON_URL);
    expect(sources).not.toContain(AO_ICON_URL);
  });

  it("updates the AR and AO rows once balancesQuery.data loads with nonzero amounts", async () => {
    const aoBalance: TokenBalance = {
      address: WALLET.address,
      processId: DEFAULT_AO_PROCESS_ID,
      ticker: "AO",
      denomination: 0,
      name: null,
      quantity: "42",
    };
    const send = sendWith({ arBalance: "5000000000000", tokenBalances: [aoBalance] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("5")).toBeTruthy());
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("still renders additional watched tokens below the AR/AO default rows", async () => {
    const extraToken: TokenBalance = {
      address: WALLET.address,
      processId: "processABC",
      ticker: "PNTS",
      denomination: 0,
      name: null,
      quantity: "500",
    };
    const send = sendWith({ tokenBalances: [extraToken] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Arweave")).toBeTruthy());
    expect(screen.getAllByText("AO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0);
  });

  it("prices a watched token from its orderbook and shows nothing for one without a price", async () => {
    const watched = (processId: string, ticker: string): TokenBalance => ({
      address: WALLET.address,
      processId,
      ticker,
      denomination: 0,
      name: null,
      quantity: "500",
      source: "watched",
    });
    const PRICED = "P".repeat(43);
    const UNPRICED = "U".repeat(43);
    const base = sendWith({ tokenBalances: [watched(PRICED, "LST"), watched(UNPRICED, "NOPE")] });
    const send = vi.fn(async (message: { type: string; payload?: { processIds?: string[] } }) => {
      if (message.type !== "getTokenPrices") return base(message as never);
      return message.payload?.processIds
        ? [{ processId: PRICED, price: 2, change24h: 0.1 }]
        : [{ processId: null, price: 3, change24h: null }];
    }) as unknown as RuntimePort["send"];
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+10.00%")).toBeTruthy());
    expect(screen.getByText("$1,000.00")).toBeTruthy();
    expect(screen.getByText(/@ \$2\.00/)).toBeTruthy();
    expect(screen.getByText("NOPE")).toBeTruthy();
    // AR and the priced token only: the unpriced row shows its amount and nothing else.
    expect(screen.getAllByText(/@ \$/)).toHaveLength(2);
    expect(send).toHaveBeenCalledWith({ type: "getTokenPrices", payload: { currency: "USD", processIds: [PRICED, UNPRICED].sort() } });
    // The priced token's $1,000 joins the chart's total, so it matches the rows.
    const total = screen.getByRole("button", { name: "Hide balances" }).textContent;
    expect(total).toBe(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(PORTFOLIO_HISTORY_7D.currentValue + 1000));
  });

  it("opens an AR send when the AR default row is clicked", async () => {
    const onSend = vi.fn();
    const onSendToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send: sendWith({ tokenBalances: [] }) }), onSend, onSendToken });

    fireEvent.click(await screen.findByRole("button", { name: /Arweave/ }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSendToken).not.toHaveBeenCalled();
  });

  it("routes the AO default row's click into onSendToken with the matching TokenBalance", async () => {
    const aoBalance: TokenBalance = {
      address: WALLET.address,
      processId: DEFAULT_AO_PROCESS_ID,
      ticker: "AO",
      denomination: 0,
      name: null,
      quantity: "42",
    };
    const send = sendWith({ tokenBalances: [aoBalance] });
    const onSendToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onSendToken });

    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /AO/ }));

    expect(onSendToken).toHaveBeenCalledWith(aoBalance);
  });
});

describe("MainScreenView scroll-fading header (main-screen-chart)", () => {
  function setScrollY(value: number) {
    Object.defineProperty(window, "scrollY", { value, configurable: true });
    fireEvent.scroll(window);
  }

  afterEach(() => {
    setScrollY(0);
  });

  it("fades out and makes the chart/actions block inert once scrolled past the threshold", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    setScrollY(200);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).closest("[inert]")).toBeTruthy(),
    );
  });

  it("swaps the account pill for a Back button once collapsed, and Back scrolls home", async () => {
    const send = successfulSend();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByRole("button", { name: /Wallet One, address/i })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    setScrollY(200);

    const back = await screen.findByRole("button", { name: "Back" });
    expect(screen.queryByRole("button", { name: /Wallet One, address/i })).toBeNull();
    fireEvent.click(back);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));

    setScrollY(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Wallet One, address/i })).toBeTruthy());
    scrollTo.mockRestore();
  });

  it("resets to the Tokens tab once scrolled back to the top", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const onTabChange = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send: successfulSend() }), initialTab: "activity", onTabChange });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    // Mounting on a restored tab doesn't reset it; only a collapse-then-expand does.
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");

    setScrollY(200);
    await screen.findByRole("button", { name: "Back" });
    setScrollY(0);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Tokens" }).getAttribute("aria-selected")).toBe("true"),
    );
    expect(onTabChange).toHaveBeenLastCalledWith("tokens");
    scrollTo.mockRestore();
  });

  it("fades the header back in and makes it interactive again once scrolled back near the top", async () => {
    const send = successfulSend();
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    setScrollY(200);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).closest("[inert]")).toBeTruthy(),
    );

    setScrollY(0);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" }).closest("[inert]")).toBeFalsy(),
    );
  });
});

describe("MainScreenView Tokens/Activity tabs (main-screen-tabs)", () => {
  // jsdom has no window.scrollTo, and every tab click calls it.
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const AO_TOKEN: TokenBalance = {
    address: WALLET.address,
    processId: "processABC",
    ticker: "PNTS",
    denomination: 0,
    name: null,
    quantity: "500",
  };

  function manyEntries(count: number): ActivityPage {
    return {
      entries: Array.from({ length: count }, (_, index) => ({
        txId: `tx-${index}`,
        type: index % 2 === 0 ? "receive" : "send",
        address: WALLET.address,
        amount: "1000000000000",
        status: "confirmed",
        tags: [],
        timestamp: Date.now() - index * 60_000,
      })),
      cursor: null,
    };
  }

  function sendWith(overrides: {
    tokenBalances?: TokenBalance[];
    activity?: ActivityPage;
  }): RuntimePort["send"] {
    return vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return overrides.tokenBalances ?? NO_TOKENS;
      if (type === "getActivity") return overrides.activity ?? EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      if (type === "getTokenPrices") return [];
      if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
  }

  it("shows the Tokens tab by default with both Tokens and Activity tab controls", async () => {
    const send = sendWith({ tokenBalances: [AO_TOKEN] });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0));
    expect(screen.getByRole("tab", { name: "Tokens" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("false");
  });

  it("switching to the Activity tab shows activity content and hides token rows", async () => {
    const send = sendWith({ tokenBalances: [AO_TOKEN], activity: manyEntries(2) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("PNTS")).toBeNull();
    await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBeGreaterThan(0));
  });

  it("shows a swap order as an order placed on the asset, not as an AR send or a receipt", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-order",
          type: "send",
          address: "processABC",
          amount: null,
          status: "confirmed",
          tags: [],
          timestamp: Date.now() - 60_000,
          swap: { process: "processABC" },
        },
      ],
      cursor: null,
    };
    renderMainScreen({ runtime: fakeRuntime({ send: sendWith({ tokenBalances: [AO_TOKEN], activity }) }) });

    await waitFor(() => expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await screen.findByText("Swap order · PNTS");
    expect(screen.getByText(/Order placed/)).toBeTruthy();
    expect(screen.queryByText(/^Sent/)).toBeNull();
  });

  it("shows the complete, untruncated token list on the Tokens tab", async () => {
    const tokens: TokenBalance[] = Array.from({ length: 12 }, (_, index) => ({
      address: WALLET.address,
      processId: `process-${index}`,
      ticker: `TK${index}`,
      denomination: 0,
      name: null,
      quantity: "1",
    }));
    const send = sendWith({ tokenBalances: tokens });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText("TK0").length).toBeGreaterThan(0));
    for (const token of tokens) {
      expect(screen.getAllByText(token.ticker).length).toBeGreaterThan(0);
    }
  });

  it.each(["Tokens", "Activity"])(
    "clicking the %s tab scrolls the list section up to its docked position under the pinned header",
    async (tabName) => {
      renderMainScreen({ runtime: fakeRuntime({ send: sendWith({}) }) });
      await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());

      const section = screen.getByRole("tablist", { name: "Tokens, collectibles and activity" }).parentElement as HTMLElement;
      vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ top: 420 } as DOMRect);
      fireEvent.click(screen.getByRole("tab", { name: tabName }));

      expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 420 - 64 }));
    },
  );

  it("caps the Activity tab at the 6 most recent entries even when more exist", async () => {
    const send = sendWith({ activity: manyEntries(15) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBe(6));
  });

  it("clicking the Activity tab's View all action opens lunar.arweave.net for the wallet address", async () => {
    const send = sendWith({ activity: manyEntries(2) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
      await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBeGreaterThan(0));

      fireEvent.click(screen.getByRole("button", { name: "View all" }));

      expect(openSpy).toHaveBeenCalledWith(
        `https://lunar.arweave.net/#/explorer/${WALLET.address}`,
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  it("clicking an ActivityRow opens its detail, whose explorer button opens lunar.arweave.net for that tx id", async () => {
    const send = sendWith({ activity: manyEntries(1) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

      await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByText(/Received|Sent/)[0]!.closest("button")!);
      expect(openSpy).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByTitle("View in explorer"));

      expect(openSpy).toHaveBeenCalledWith(
        "https://lunar.arweave.net/#/explorer/tx-0",
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  const OTHER = "zQ9xW2vE7rT4yU1iO8pA5sD3fG6hJ0kL2zX4cV7bN1m";

  function withContacts(base: RuntimePort["send"], contacts: Array<{ address: string; name: string }>): RuntimePort["send"] {
    return vi.fn(async (message: { type: string; payload: unknown }) => {
      if (message.type === "listContacts") return contacts;
      if (message.type === "saveContact") return message.payload;
      return base(message as never);
    }) as unknown as RuntimePort["send"];
  }

  const sentTo = (address: string): ActivityPage => ({
    entries: [{ txId: "tx-s", type: "send", address, amount: "1000000000000", status: "confirmed", tags: [], timestamp: Date.now() }],
    cursor: null,
  });

  it("names an activity entry's counterparty by its saved contact name", async () => {
    const send = withContacts(sendWith({ activity: sentTo(OTHER) }), [{ address: OTHER, name: "Alice" }]);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("Sent to Alice")).toBeTruthy());
  });

  it("opens send prefilled for AR from an entry's detail", async () => {
    const onSendTo = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send: withContacts(sendWith({ activity: sentTo(OTHER) }), []) }), onSendTo });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click((await screen.findByText(/Sent/)).closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Resend to this address" }));

    expect(onSendTo).toHaveBeenCalledWith(OTHER, null);
  });

  it("saves an entry's address as a contact from its detail", async () => {
    const send = withContacts(sendWith({ activity: sentTo(OTHER) }), []);
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click((await screen.findByText(/Sent/)).closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Save address" }));
    expect(screen.getByRole("button", { name: /· just now/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "saveContact", payload: { address: OTHER, name: "Bob" } }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save address" })).toBeNull());
  });

  it("labels an AO token activity entry with the token's own ticker and denomination, not AR", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-ao",
          type: "receive",
          address: WALLET.address,
          amount: "500",
          status: "confirmed",
          tags: [],
          timestamp: Date.now(),
          token: "processABC",
        },
      ],
      cursor: null,
    };
    const send = sendWith({ tokenBalances: [AO_TOKEN], activity });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("+500 PNTS")).toBeTruthy());
    expect(screen.queryByText(/AR$/)).toBeNull();
  });

  it("shows the raw atomic amount, not a denomination-scaled guess, for an entry whose matching balance is unavailable", async () => {
    const unavailableToken: TokenBalance = {
      address: WALLET.address,
      processId: "processABC",
      ticker: "PNTS",
      denomination: 12,
      name: null,
      quantity: "0",
      available: false,
    };
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-ao-unavailable",
          type: "receive",
          address: WALLET.address,
          amount: "500",
          status: "confirmed",
          tags: [],
          timestamp: Date.now(),
          token: "processABC",
        },
      ],
      cursor: null,
    };
    const send = sendWith({ tokenBalances: [unavailableToken], activity });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    // Never scaled by the unavailable row's (untrustworthy) denomination —
    // shows the raw atomic amount instead, same as "no match at all", but
    // still uses the resolved ticker since identity is known even though
    // the balance isn't.
    await waitFor(() => expect(screen.getByText("+500 PNTS")).toBeTruthy());
  });

  it("falls back to a shortened process id when an AO entry's token isn't in the balance list", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-ao-unknown",
          type: "send",
          address: WALLET.address,
          amount: "42",
          status: "confirmed",
          tags: [],
          timestamp: Date.now(),
          token: "unknownProcessId000000000000000000000000000",
        },
      ],
      cursor: null,
    };
    const send = sendWith({ activity });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("-42 unknow…0000")).toBeTruthy());
  });

  it("shows a collectible send as its name and thumbnail, not an amount", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-nft",
          type: "send",
          address: "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno",
          amount: null,
          status: "pending",
          tags: [],
          timestamp: Date.now(),
          token: null,
          collectible: { id: "asset", name: "Beam #1", imageUrl: "https://arweave.net/asset" },
        },
        {
          txId: "tx-nft-gateway",
          type: "send",
          address: "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno",
          amount: null,
          status: "confirmed",
          tags: [],
          timestamp: Date.now() - 1000,
          collectible: { id: "asset-2" },
        },
      ],
      cursor: null,
    };
    const send = sendWith({ activity });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("Sent · Beam #1")).toBeTruthy());
    expect(screen.getByRole("img", { name: "Beam #1" })).toBeTruthy();
    expect(screen.getByText("Sent · Collectible")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("shows an upload as its content type and data size", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-upload",
          type: "upload",
          address: WALLET.address,
          amount: null,
          dataSize: "12400",
          status: "confirmed",
          tags: [{ name: "Content-Type", value: "image/png" }],
          timestamp: Date.now() - 1000,
        },
      ],
      cursor: null,
    };
    renderMainScreen({ runtime: fakeRuntime({ send: sendWith({ activity }) }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("Uploaded · image/png")).toBeTruthy());
    expect(screen.getByText("12.4 kB")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("still labels a native AR activity entry AR", async () => {
    const activity: ActivityPage = {
      entries: [
        {
          txId: "tx-ar",
          type: "receive",
          address: WALLET.address,
          amount: "1000000000000",
          status: "confirmed",
          tags: [],
          timestamp: Date.now(),
        },
      ],
      cursor: null,
    };
    const send = sendWith({ activity });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getByText("+1 AR")).toBeTruthy());
  });
});

describe("MainScreenView pull to refresh", () => {
  afterEach(() => {
    delete document.body.dataset.layout;
  });

  function pullDown(el: Element) {
    const fire = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { touches: type === "touchend" ? [] : [{ clientX: 50, clientY: y }] });
      act(() => {
        el.dispatchEvent(event);
      });
    };
    fire("touchstart", 100);
    fire("touchmove", 260);
    fire("touchend", 260);
  }

  const calls = (send: RuntimePort["send"], type: string) =>
    (send as ReturnType<typeof vi.fn>).mock.calls.filter(([m]) => m.type === type).length;

  it("refetches balances, activity, prices and the chart on a phone", async () => {
    document.body.dataset.layout = "phone";
    const send = successfulSend();
    const { container } = renderMainScreen({ runtime: fakeRuntime({ send }) });
    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    const before = ["getBalance", "getActivity", "getTokenPrices", "getPortfolioHistory"].map((t) => calls(send, t));

    pullDown(container.firstElementChild!);

    await waitFor(() =>
      ["getBalance", "getActivity", "getTokenPrices", "getPortfolioHistory"].forEach((t, i) =>
        expect(calls(send, t)).toBeGreaterThan(before[i]!),
      ),
    );
  });

  it("shows the top bar only while the pulled refresh runs, even when it fails", async () => {
    document.body.dataset.layout = "phone";
    let fail: ((reason: Error) => void) | undefined;
    let pulled = false;
    const ok = successfulSend();
    const send = vi.fn(async (message: { type: string }) => {
      if (pulled && message.type === "getBalance") return new Promise((_, reject) => (fail = reject));
      return (ok as (m: unknown) => Promise<unknown>)(message);
    }) as RuntimePort["send"];
    const { container } = renderMainScreen({ runtime: fakeRuntime({ send }) });
    await waitFor(() => expect(screen.getByText("+20.00%")).toBeTruthy());
    expect(screen.queryByRole("status", { name: "Refreshing" })).toBeNull();

    pulled = true;
    pullDown(container.firstElementChild!);
    expect(await screen.findByRole("status", { name: "Refreshing" })).toBeTruthy();

    await waitFor(() => expect(fail).toBeDefined());
    await act(async () => fail!(new Error("offline")));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Refreshing" })).toBeNull());
  });
});

describe("MainScreenView cached-to-live", () => {
  const CACHED = { arBalance: "1500000000000", tokenBalances: NO_TOKENS };

  /** The token row's amount; the same figure can also appear elsewhere on the screen. */
  const amountCell = (text: string) => screen.getAllByText(text).find((el) => el.className.includes("text-caption"))!;

  function setup(seed: boolean) {
    let resolveBalance: (value: Winston) => void = () => {};
    let rejectBalance: (reason: Error) => void = () => {};
    const gate = new Promise<Winston>((resolve, reject) => {
      resolveBalance = resolve;
      rejectBalance = reject;
    });
    let later = false;
    const base = successfulSend();
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getBalance") return later ? "3500000000000" : gate;
      return base(message as never);
    }) as RuntimePort["send"];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (seed) {
      queryClient.setQueryData([WALLET.address, "balances"], CACHED, { updatedAt: 1 });
      queryClient.setQueryData([WALLET.address, "activity"], EMPTY_ACTIVITY, { updatedAt: 1 });
    }
    render(
      <QueryClientProvider client={queryClient}>
        <MainScreenView
          runtime={fakeRuntime({ send })}
          wallet={WALLET}
          onSend={vi.fn()}
          onSendToken={vi.fn()}
          onReceive={vi.fn()}
          onOpenWalletSwitcher={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenPoints={vi.fn()}
          onUseGleamOnSite={vi.fn()}
          onOpenCollectible={vi.fn()}
          onAddToken={vi.fn()}
        />
      </QueryClientProvider>,
    );
    return { queryClient, resolveBalance, rejectBalance, fetchLater: () => (later = true) };
  }

  it("shows restored rows at full strength, then settles them once fresh data lands", async () => {
    const { resolveBalance } = setup(true);
    expect(amountCell("1.5").className).not.toContain("gleam-shimmer");
    expect(amountCell("1.5").className).not.toContain("opacity-70");
    expect(screen.queryByRole("status", { name: "Refreshing" })).toBeNull();
    await act(async () => {
      resolveBalance("2500000000000");
    });
    await waitFor(() => expect(amountCell("2.5").className).toContain("gleam-fresh"));
  });

  it("keeps restored rows as they are after the refetch fails", async () => {
    const { rejectBalance } = setup(true);
    await act(async () => {
      rejectBalance(new Error("offline"));
    });
    expect(amountCell("1.5").className).not.toContain("opacity-70");
    expect(amountCell("1.5").className).not.toContain("gleam-fresh");
  });

  it("renders never-cached rows at full", async () => {
    const { resolveBalance } = setup(false);
    await act(async () => {
      resolveBalance("2500000000000");
    });
    await screen.findAllByText("2.5");
    expect(amountCell("2.5").className).not.toContain("gleam-fresh");
  });

  it("keeps a later poll of fresh data off the top bar", async () => {
    const { queryClient, resolveBalance, fetchLater } = setup(true);
    await act(async () => {
      resolveBalance("2500000000000");
    });
    await waitFor(() => expect(amountCell("2.5")).toBeTruthy());
    fetchLater();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: [WALLET.address, "balances"] });
    });
    await waitFor(() => expect(amountCell("3.5")).toBeTruthy());
    expect(screen.queryByRole("status", { name: "Refreshing" })).toBeNull();
  });
});
