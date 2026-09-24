import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { WalletDetailView } from "./WalletDetailView";

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

const JWK = { kty: "RSA", n: "n".repeat(10), e: "AQAB" };

describe("WalletDetailView", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("shows the wallet's name, method and truncated address", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.getByText("JWK")).toBeTruthy();
    expect(screen.getByDisplayValue("Wallet One")).toBeTruthy();
  });

  it("shows 'Not backed up' when backupConfirmedAt is null", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.getByText("Not backed up")).toBeTruthy();
    expect(screen.getByText("No backup on record")).toBeTruthy();
  });

  it("shows 'Backed up' when backupConfirmedAt is set", () => {
    const send = vi.fn();
    const wallet = { ...WALLET, backupConfirmedAt: Date.now() };
    render(<WalletDetailView runtime={fakeRuntime({ send })} wallet={wallet} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />);

    expect(screen.getByText("Backed up")).toBeTruthy();
  });

  it("calls renameWallet on blur when the name changed, then onRenamed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onRenamed = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={onRenamed} onRemoved={vi.fn()} />,
    );

    const input = screen.getByDisplayValue("Wallet One");
    fireEvent.change(input, { target: { value: "Renamed Wallet" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "renameWallet",
        payload: { walletId: "wallet-1", name: "Renamed Wallet" },
      }),
    );
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("Renamed Wallet"));
  });

  it("does not call renameWallet on blur when the name is unchanged", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    const input = screen.getByDisplayValue("Wallet One");
    fireEvent.blur(input);

    expect(send).not.toHaveBeenCalled();
  });

  it("shows a rename error inline and does not call onRenamed", async () => {
    const send = vi.fn().mockRejectedValue(new Error("No stored wallet"));
    const onRenamed = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={onRenamed} onRemoved={vi.fn()} />,
    );

    const input = screen.getByDisplayValue("Wallet One");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByText("No stored wallet")).toBeTruthy());
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("walks the back-up flow: password -> reveal -> download records confirmWalletBackup", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(JWK) // exportWallet
      .mockResolvedValueOnce(undefined); // confirmWalletBackup
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back up keyfile" }));
    await waitFor(() => expect(screen.getByText("Enter your password")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "exportWallet",
        payload: { walletId: "wallet-1", password: "correct horse battery staple" },
      }),
    );
    await waitFor(() => expect(screen.getByText("Your keyfile")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Download keyfile" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "confirmWalletBackup",
        payload: { walletId: "wallet-1" },
      }),
    );
  });

  it("walks the back-up flow: password -> reveal -> copy records confirmWalletBackup", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const send = vi
      .fn()
      .mockResolvedValueOnce(JWK) // exportWallet
      .mockResolvedValueOnce(undefined); // confirmWalletBackup
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back up keyfile" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Your keyfile")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(JWK)));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "confirmWalletBackup",
        payload: { walletId: "wallet-1" },
      }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  it("does not record the backup as confirmed when the clipboard write rejects, and shows an error", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard write failed"));
    Object.assign(navigator, { clipboard: { writeText } });
    const send = vi.fn().mockResolvedValueOnce(JWK); // exportWallet only — confirmWalletBackup must not be reached
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back up keyfile" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Your keyfile")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(screen.getByText("Clipboard write failed")).toBeTruthy());
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirmWalletBackup" }),
    );
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText("Not backed up")).toBeTruthy());
  });

  it("shows the server error and lets the user retry the password", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("That password didn't work."));
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back up keyfile" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("That password didn't work.")).toBeTruthy());
  });

  it("calls onBack from the detail screen's header", () => {
    const onBack = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime()} wallet={WALLET} onBack={onBack} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("warns explicitly that access is lost permanently when there's no confirmed backup", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));

    expect(screen.getByRole("alert").textContent).toMatch(/lost permanently/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not show the backup-loss warning once a backup is confirmed", () => {
    const send = vi.fn();
    const wallet = { ...WALLET, backupConfirmedAt: Date.now() };
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={wallet} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/re-import it later/i)).toBeTruthy();
  });

  it("calls deleteWallet and onRemoved when the removal is confirmed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onRemoved = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={onRemoved} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove wallet" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "deleteWallet",
        payload: { walletId: "wallet-1" },
      }),
    );
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it("shows a server error and does not call onRemoved when deleteWallet fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("No stored wallet"));
    const onRemoved = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={onRemoved} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove wallet" }));

    await waitFor(() => expect(screen.getByText("No stored wallet")).toBeTruthy());
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("cancels back to the detail screen without deleting", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Not backed up")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});
