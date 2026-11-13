import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import type { BackupStatus, RuntimePort, WalletSummary } from "@gleam/core";
import { cloudBackupOf, WalletDetailView } from "./WalletDetailView";

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

const PASSWORD = "correct horse battery staple";

function startBackup() {
  fireEvent.click(screen.getByRole("button", { name: /^Back up keyfile/ }));
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Save keyfile" }));
}

describe("WalletDetailView", () => {

  it("shows the wallet's name with no method label for a JWK wallet", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.queryByText(/JWK/)).toBeNull();
    expect(screen.getByDisplayValue("Wallet One")).toBeTruthy();
  });

  it("hides keyfile backup for a hardware wallet and labels its method", () => {
    const keystone: WalletSummary = { ...WALLET, method: "keystone", device: { kind: "keystone", xfp: "1a2b3c4d" } };
    render(
      <WalletDetailView runtime={fakeRuntime()} wallet={keystone} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.getByText(/Keystone/)).toBeTruthy();
    expect(screen.queryByText("Back up keyfile")).toBeNull();
  });

  it("hides keyfile backup for a watch wallet, labels it, and says removing it loses nothing", () => {
    const watched: WalletSummary = { ...WALLET, method: "watch", publicKey: "" };
    render(
      <WalletDetailView runtime={fakeRuntime()} wallet={watched} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.getByText(/Watch only/)).toBeTruthy();
    expect(screen.queryByText("Back up keyfile")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));
    expect(screen.getByText(/only watches this address/)).toBeTruthy();
  });

  it("shows 'Not backed up yet' when backupConfirmedAt is null", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    expect(screen.getByText("Not backed up yet")).toBeTruthy();
  });

  it("shows 'Backed up' when backupConfirmedAt is set", () => {
    const send = vi.fn();
    const wallet = { ...WALLET, backupConfirmedAt: Date.now() };
    render(<WalletDetailView runtime={fakeRuntime({ send })} wallet={wallet} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />);

    expect(screen.getByText("Backed up today")).toBeTruthy();
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

  function renderForBackup(send: RuntimePort["send"], requestDownloadPermission = vi.fn(async () => true)) {
    render(
      <WalletDetailView
        runtime={fakeRuntime({ send })}
        wallet={WALLET}
        onBack={vi.fn()}
        onRenamed={vi.fn()}
        onRemoved={vi.fn()}
        requestDownloadPermission={requestDownloadPermission}
      />,
    );
    return requestDownloadPermission;
  }

  it("warns that the saved keyfile isn't password-protected", async () => {
    renderForBackup(vi.fn());

    fireEvent.click(screen.getByRole("button", { name: /^Back up keyfile/ }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("isn't password-protected"));
  });

  it("has the background save the keyfile and shows it backed up, with no separate confirm call", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, filename: "wallet-one-arweave-keyfile.json" });
    const requestDownloadPermission = renderForBackup(send);

    fireEvent.click(screen.getByRole("button", { name: /^Back up keyfile/ }));
    await waitFor(() => expect(screen.getByText("Enter your password")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Save keyfile" }));

    await waitFor(() => expect(screen.getByText("Saved as wallet-one-arweave-keyfile.json")).toBeTruthy());
    expect(requestDownloadPermission).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "downloadKeyfile",
      payload: { walletId: "wallet-1", password: PASSWORD },
    });
  });

  it("explains a denied downloads permission", async () => {
    const send = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {})) // downloadKeyfile, still waiting for the grant
      .mockResolvedValueOnce(undefined); // cancelKeyfileDownload
    renderForBackup(send, vi.fn(async () => false));

    startBackup();

    await waitFor(() => expect(screen.getByText(/needs permission to manage downloads/)).toBeTruthy());
    expect(send).toHaveBeenLastCalledWith({ type: "cancelKeyfileDownload", payload: { walletId: "wallet-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText("Not backed up yet")).toBeTruthy());
  });

  it("shows a cancelled download as not backed up", async () => {
    renderForBackup(vi.fn().mockResolvedValueOnce({ ok: false, reason: "cancelled" }));

    startBackup();

    await waitFor(() => expect(screen.getByText("Saving the keyfile was cancelled.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText("Not backed up yet")).toBeTruthy());
  });

  it("shows a failed download", async () => {
    renderForBackup(vi.fn().mockResolvedValueOnce({ ok: false, reason: "failed" }));

    startBackup();

    await waitFor(() => expect(screen.getByText("The keyfile couldn't be saved.")).toBeTruthy());
  });

  it("shows the server error and lets the user retry the password", async () => {
    renderForBackup(vi.fn().mockRejectedValueOnce(new Error("That password didn't work.")));

    startBackup();

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

  it("warns explicitly that access is lost for good when there's no confirmed backup", () => {
    const send = vi.fn();
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={WALLET} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));

    expect(screen.getByRole("alert").textContent).toMatch(/lose access for good/i);
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

    expect(screen.getByText("Not backed up yet")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("cloudBackupOf", () => {
  const on: BackupStatus = { provider: "google", enabled: true, lastBackupAt: 2_000, problem: null };

  it("names the drive once a write after the wallet was added went through", () => {
    expect(cloudBackupOf(on, { createdAt: 1_000 })).toBe("Google Drive");
    expect(cloudBackupOf({ ...on, provider: "icloud" }, { createdAt: 2_000 })).toBe("iCloud");
  });

  it("doesn't count a wallet added after the last write", () => {
    expect(cloudBackupOf(on, { createdAt: 3_000 })).toBeNull();
  });

  it("doesn't count a backup that is off, stopped or never written", () => {
    expect(cloudBackupOf({ ...on, enabled: false }, { createdAt: 0 })).toBeNull();
    expect(cloudBackupOf({ ...on, problem: "signIn" }, { createdAt: 0 })).toBeNull();
    expect(cloudBackupOf({ ...on, problem: "missing" }, { createdAt: 0 })).toBeNull();
    expect(cloudBackupOf({ ...on, lastBackupAt: null }, { createdAt: 0 })).toBeNull();
  });
});

describe("WalletDetailView with a cloud backup", () => {
  const status: BackupStatus = { provider: "google", enabled: true, lastBackupAt: 5_000, problem: null };
  const withCloud = () => fakeAppPlatform({ capabilities: { cloudBackup: "google" } });

  function renderDetail(send: RuntimePort["send"], wallet: WalletSummary = WALLET, platform = withCloud()) {
    render(
      <WalletDetailView runtime={fakeRuntime({ send })} wallet={wallet} onBack={vi.fn()} onRenamed={vi.fn()} onRemoved={vi.fn()} />,
      platform,
    );
  }

  it("says the wallet is in the cloud backup instead of warning", async () => {
    renderDetail(vi.fn(async () => status) as RuntimePort["send"]);
    expect(await screen.findByText("Backed up to Google Drive")).toBeTruthy();
    expect(screen.queryByText("Not backed up yet")).toBeNull();
  });

  it("still warns about a wallet the backup hasn't caught up with", async () => {
    const send = vi.fn(async () => status) as RuntimePort["send"];
    renderDetail(send, { ...WALLET, createdAt: 6_000 });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(screen.getByText("Not backed up yet")).toBeTruthy();
  });

  it("keeps the keyfile download's date when there is one", async () => {
    const send = vi.fn(async () => status) as RuntimePort["send"];
    renderDetail(send, { ...WALLET, backupConfirmedAt: Date.now() });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(screen.getByText("Backed up today")).toBeTruthy();
  });

  it("doesn't ask on a shell without cloud backup", () => {
    const send = vi.fn();
    renderDetail(send, WALLET, fakeAppPlatform());
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText("Not backed up yet")).toBeTruthy();
  });

  it("still warns before removing, since removal also drops the wallet from the backup", async () => {
    renderDetail(vi.fn(async () => status) as RuntimePort["send"]);
    await screen.findByText("Backed up to Google Drive");
    fireEvent.click(screen.getByRole("button", { name: "Remove wallet" }));
    expect(screen.getByText(/You haven't backed up this wallet's keyfile/)).toBeTruthy();
  });
});
