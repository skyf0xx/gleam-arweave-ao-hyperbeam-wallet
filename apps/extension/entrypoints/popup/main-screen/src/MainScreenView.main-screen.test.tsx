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

function successfulSend(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getBalance") return BALANCE;
    if (type === "getTokenBalances") return NO_TOKENS;
    if (type === "getActivity") return EMPTY_ACTIVITY;
    if (type === "getThemePreference") return overrides.themePreference ?? { theme: "light" };
    if (type === "setThemePreference") return undefined;
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

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
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
