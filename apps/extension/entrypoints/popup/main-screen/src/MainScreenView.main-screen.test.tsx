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
      onSendToken={vi.fn()}
      onReceive={vi.fn()}
      onOpenWalletSwitcher={vi.fn()}
      onOpenSettings={vi.fn()}
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

  it("calls onOpenSettings when the gear button is pressed", async () => {
    const send = successfulSend();
    const onOpenSettings = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onOpenSettings });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenSettings).toHaveBeenCalled();
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
      if (type === "getPortfolioHistory") throw new Error("unreachable");
      throw new Error(`Unexpected message type "${type}"`);
    });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText(/couldn't reach the network/i).length).toBeGreaterThan(0));
  });
});

describe("MainScreenView token rows (AO-TOKEN-SEND-WALLET-CORE)", () => {
  const AO_TOKEN: TokenBalance = {
    address: WALLET.address,
    processId: "processABC",
    ticker: "PNTS",
    denomination: 0,
    quantity: "500",
  };

  it("calls onSendToken with the token when its row is clicked — every listed token is genuinely sendable", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [AO_TOKEN];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      throw new Error(`Unexpected message type "${type}"`);
    });
    const onSendToken = vi.fn();
    renderMainScreen({ runtime: fakeRuntime({ send }), onSendToken });

    await waitFor(() => expect(screen.getAllByText("PNTS").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /PNTS/ }));

    expect(onSendToken).toHaveBeenCalledWith(AO_TOKEN);
  });

  it("formats a token's balance in its own denomination, not as a raw atomic-unit integer", async () => {
    const SCALED_TOKEN: TokenBalance = {
      address: WALLET.address,
      processId: "processXYZ",
      ticker: "USDC",
      denomination: 6,
      quantity: "1500000",
    };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return [SCALED_TOKEN];
      if (type === "getActivity") return EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      throw new Error(`Unexpected message type "${type}"`);
    });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("1.5")).toBeTruthy());
    expect(screen.queryByText("1500000")).toBeNull();
  });
});

describe("MainScreenView Tokens/Activity tabs (main-screen-tabs)", () => {
  const AO_TOKEN: TokenBalance = {
    address: WALLET.address,
    processId: "processABC",
    ticker: "PNTS",
    denomination: 0,
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
  }): ReturnType<typeof vi.fn> {
    return vi.fn(async ({ type }: { type: string }) => {
      if (type === "getBalance") return BALANCE;
      if (type === "getTokenBalances") return overrides.tokenBalances ?? NO_TOKENS;
      if (type === "getActivity") return overrides.activity ?? EMPTY_ACTIVITY;
      if (type === "getPortfolioHistory") return PORTFOLIO_HISTORY_7D;
      throw new Error(`Unexpected message type "${type}"`);
    });
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

  it("shows the complete, untruncated token list on the Tokens tab", async () => {
    const tokens: TokenBalance[] = Array.from({ length: 12 }, (_, index) => ({
      address: WALLET.address,
      processId: `process-${index}`,
      ticker: `TK${index}`,
      denomination: 0,
      quantity: "1",
    }));
    const send = sendWith({ tokenBalances: tokens });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getAllByText("TK0").length).toBeGreaterThan(0));
    for (const token of tokens) {
      expect(screen.getAllByText(token.ticker).length).toBeGreaterThan(0);
    }
  });

  it("caps the Activity tab at the 10 most recent entries even when more exist", async () => {
    const send = sendWith({ activity: manyEntries(15) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBe(10));
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

  it("clicking an ActivityRow opens lunar.arweave.net for that entry's tx id", async () => {
    const send = sendWith({ activity: manyEntries(1) });
    renderMainScreen({ runtime: fakeRuntime({ send }) });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

      await waitFor(() => expect(screen.getAllByText(/Received|Sent/).length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByText(/Received|Sent/)[0]!.closest("button")!);

      expect(openSpy).toHaveBeenCalledWith(
        "https://lunar.arweave.net/#/explorer/tx-0",
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      openSpy.mockRestore();
    }
  });
});
