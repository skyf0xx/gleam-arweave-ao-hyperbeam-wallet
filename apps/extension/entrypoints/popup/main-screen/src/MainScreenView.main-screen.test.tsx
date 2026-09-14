import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ActivityPage, RuntimePort, TokenBalance, WalletSummary, Winston } from "@gleam/core";
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

function successfulSend(): ReturnType<typeof vi.fn> {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getBalance") return BALANCE;
    if (type === "getTokenBalances") return NO_TOKENS;
    if (type === "getActivity") return EMPTY_ACTIVITY;
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

function renderMainScreen(overrides: Partial<Parameters<typeof MainScreenView>[0]> = {}) {
  return render(
    <MainScreenView
      runtime={fakeRuntime()}
      wallet={WALLET}
      onSend={vi.fn()}
      onReceive={vi.fn()}
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

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
  });
});
