import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import type { RuntimePort, WalletState } from "@gleam/core";
import { sortByName, WalletSwitcherView } from "./WalletSwitcherView";

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

const STATE: WalletState = {
  wallets: [
    {
      id: "wallet-1",
      address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
      name: "Wallet One",
      method: "jwk",
      publicKey: "pub1",
      createdAt: 0,
      updatedAt: 0,
      backupConfirmedAt: null,
    },
    {
      id: "wallet-2",
      address: "Kx7p2mNwR4tL9jH6vD3sF8eQ1cA5bY0abcdefgh",
      name: "Trading",
      method: "jwk",
      publicKey: "pub2",
      createdAt: 0,
      updatedAt: 0,
      backupConfirmedAt: null,
    },
  ],
  activeWalletId: "wallet-1",
  session: null,
};

describe("WalletSwitcherView (7.1 wallet-switcher)", () => {
  it("labels only a watch-only wallet", async () => {
    const [first, second] = STATE.wallets;
    const send = vi.fn().mockResolvedValue({ ...STATE, wallets: [first, { ...second!, method: "watch", publicKey: "" }] });
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Trading")).toBeTruthy());
    expect(screen.getAllByText(/Watch only/)).toHaveLength(1);
    expect(screen.getByText("Trading").closest("button")?.textContent).toContain("Watch only");
  });

  it("lists every wallet from getState and marks the active one", async () => {
    const send = vi.fn().mockResolvedValue(STATE);
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    expect(screen.getByText("Trading")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "getState", payload: undefined });
  });

  it("lists wallets by name, whichever is active or saved first", async () => {
    const [first, second] = STATE.wallets;
    const send = vi.fn().mockResolvedValue({ ...STATE, wallets: [second, first], activeWalletId: "wallet-2" });
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    const position = screen.getByText("Trading").compareDocumentPosition(screen.getByText("Wallet One"));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Trading").closest("button")?.getAttribute("aria-current")).toBe("true");
  });

  it("sorts names naturally, ignoring case", () => {
    const named = (name: string) => ({ ...STATE.wallets[0]!, id: name, name });
    const sorted = sortByName([named("wallet 10"), named("Wallet 2"), named("alpha")], "en").map((wallet) => wallet.name);
    expect(sorted).toEqual(["alpha", "Wallet 2", "wallet 10"]);
  });

  it("calls switchWallet with the tapped row's walletId, then onSwitched", async () => {
    const send = vi.fn().mockResolvedValueOnce(STATE).mockResolvedValueOnce(undefined);
    const onSwitched = vi.fn();
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={onSwitched} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Trading")).toBeTruthy());
    fireEvent.click(screen.getByText("Trading"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "switchWallet", payload: { walletId: "wallet-2" } }),
    );
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("wallet-2"));
  });

  it("does not call switchWallet when tapping the already-active wallet", async () => {
    const send = vi.fn().mockResolvedValue(STATE);
    const onSwitched = vi.fn();
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={onSwitched} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByText("Wallet One"));

    expect(send).toHaveBeenCalledTimes(1);
    expect(onSwitched).not.toHaveBeenCalled();
  });

  it("shows the network error banner and retries on a failed load", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("unreachable")).mockResolvedValueOnce(STATE);
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
  });

  it("renders each wallet row with its own address-seeded avatar, matching the main screen's account pill", async () => {
    const send = vi.fn().mockResolvedValue(STATE);
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={vi.fn()} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());

    const walletOneAvatar = screen.getByRole("img", { name: "Wallet One avatar" });
    const tradingAvatar = screen.getByRole("img", { name: "Trading avatar" });
    expect(walletOneAvatar.innerHTML).not.toBe("");
    expect(tradingAvatar.innerHTML).not.toBe("");
    expect(walletOneAvatar.innerHTML).not.toBe(tradingAvatar.innerHTML);
    expect(screen.queryByText("W")).toBeNull();
    expect(screen.queryByText("T")).toBeNull();
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    const send = vi.fn().mockResolvedValue(STATE);
    render(<WalletSwitcherView runtime={fakeRuntime({ send })} onSwitched={vi.fn()} onBack={onBack} onAddWallet={vi.fn()} onManage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("calls onAddWallet when Add wallet is pressed", async () => {
    const onAddWallet = vi.fn();
    const send = vi.fn().mockResolvedValue(STATE);
    render(
      <WalletSwitcherView
        runtime={fakeRuntime({ send })}
        onSwitched={vi.fn()}
        onBack={vi.fn()}
        onAddWallet={onAddWallet}
        onManage={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Wallet One")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add wallet" }));
    expect(onAddWallet).toHaveBeenCalledOnce();
  });

  it("calls onManage with the wallet's id when its manage chevron is pressed", async () => {
    const onManage = vi.fn();
    const send = vi.fn().mockResolvedValue(STATE);
    render(
      <WalletSwitcherView
        runtime={fakeRuntime({ send })}
        onSwitched={vi.fn()}
        onBack={vi.fn()}
        onAddWallet={vi.fn()}
        onManage={onManage}
      />,
    );

    await waitFor(() => expect(screen.getByText("Trading")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Manage Trading" }));
    expect(onManage).toHaveBeenCalledWith("wallet-2");
  });

  it("switches, not opens details, when a wallet's address is tapped", async () => {
    const onManage = vi.fn();
    const onSwitched = vi.fn();
    const send = vi.fn().mockImplementation(async (message: { type: string }) => (message.type === "getState" ? STATE : undefined));
    render(
      <WalletSwitcherView
        runtime={fakeRuntime({ send })}
        onSwitched={onSwitched}
        onBack={vi.fn()}
        onAddWallet={vi.fn()}
        onManage={onManage}
      />,
    );

    await waitFor(() => expect(screen.getByText("Trading")).toBeTruthy());
    fireEvent.click(screen.getByText(STATE.wallets[1]!.address));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("wallet-2"));
    expect(onManage).not.toHaveBeenCalled();
  });
});
