import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { OnboardingView } from "./OnboardingView";

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

const GOOD_PASSWORD = "correct horse battery staple";

function openKeyfileImport() {
  fireEvent.click(screen.getByRole("button", { name: "I already have a wallet" }));
  fireEvent.click(screen.getByRole("button", { name: "Import a keyfile" }));
}

describe("OnboardingView: create flow", () => {
  it("walks welcome -> password -> backup, and the download goes through the background", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockResolvedValueOnce({ ok: true, filename: "wallet-1-arweave-keyfile.json" }); // downloadKeyfile
    const runtime = fakeRuntime({ send });
    const onComplete = vi.fn();

    const requestDownloadPermission = vi.fn(async () => true);
    render(
      <OnboardingView runtime={runtime} onComplete={onComplete} requestDownloadPermission={requestDownloadPermission} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));

    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Your wallet is ready")).toBeTruthy());

    // The wallet's display name is a randomly chosen default
    // (`randomDefaultWalletName()`), not a value this test controls —
    // asserted as "some non-empty string", not a specific literal.
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "createWallet",
      payload: { name: expect.any(String), password: GOOD_PASSWORD },
    });
    expect(send).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Download keyfile" }));
    await waitFor(() => expect(screen.getByText("Saved as wallet-1-arweave-keyfile.json")).toBeTruthy());
    expect(requestDownloadPermission).toHaveBeenCalledOnce();
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "downloadKeyfile",
      payload: { walletId: "wallet-1", password: GOOD_PASSWORD },
    });
    // The background records the backup itself.
    expect(send).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("finishes onboarding instead of returning to Welcome when backup's back button is used", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockResolvedValueOnce({ ok: true, filename: "wallet-1-arweave-keyfile.json" }); // downloadKeyfile
    const runtime = fakeRuntime({ send });
    const onComplete = vi.fn();

    render(<OnboardingView runtime={runtime} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Your wallet is ready")).toBeTruthy());

    // The wallet the user just created already exists, so going back must
    // not land on Welcome's "Create a wallet" — that would re-run
    // createWallet with a new password, which the vault rejects.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Create a wallet" })).toBeNull();
  });

  async function reachBackup(send: RuntimePort["send"], requestDownloadPermission = vi.fn(async () => true)) {
    render(
      <OnboardingView
        runtime={fakeRuntime({ send })}
        onComplete={vi.fn()}
        requestDownloadPermission={requestDownloadPermission}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Your wallet is ready")).toBeTruthy());
  }

  function downloadButton() {
    return screen.getByRole("button", { name: "Download keyfile" }) as HTMLButtonElement;
  }

  it.each([
    ["cancelled", "The download was cancelled."],
    ["failed", "The keyfile couldn't be saved."],
  ])("after a %s download, offers a retry and points to wallet settings", async (reason, message) => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockResolvedValueOnce({ ok: false, reason }) // downloadKeyfile
      .mockResolvedValueOnce({ ok: true, filename: "wallet-1-arweave-keyfile.json" }); // retry
    await reachBackup(send);

    fireEvent.click(downloadButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(screen.getByRole("alert").textContent).toContain("from this wallet's settings");
    expect(screen.getByText("I'll back this up later")).toBeTruthy();
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
    fireEvent.click(downloadButton());
    await waitFor(() => expect(screen.getByText("Saved as wallet-1-arweave-keyfile.json")).toBeTruthy());
    expect(send).toHaveBeenLastCalledWith({
      type: "downloadKeyfile",
      payload: { walletId: "wallet-1", password: expect.any(String) },
    });
    expect(downloadButton().disabled).toBe(true);
  });

  it("explains a denied downloads permission and saves nothing", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockReturnValueOnce(new Promise(() => {})) // downloadKeyfile, still waiting for the grant
      .mockResolvedValueOnce(undefined); // cancelKeyfileDownload
    await reachBackup(send, vi.fn(async () => false));

    fireEvent.click(downloadButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("needs permission to manage downloads"));
    expect(downloadButton().disabled).toBe(false);
    expect(send).toHaveBeenLastCalledWith({ type: "cancelKeyfileDownload", payload: { walletId: "wallet-1" } });
  });

  it("drops the password after a successful download too", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockResolvedValueOnce({ ok: true, filename: "wallet-1-arweave-keyfile.json" }); // downloadKeyfile
    await reachBackup(send);

    fireEvent.click(downloadButton());

    await waitFor(() => expect(screen.getByText("Saved as wallet-1-arweave-keyfile.json")).toBeTruthy());
    expect(downloadButton().disabled).toBe(true);
  });

  it("surfaces a server-side rejection (e.g. common password) as an inline error", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("That password is too common."));
    const runtime = fakeRuntime({ send });

    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));

    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("too common"));
  });
});

describe("OnboardingView: import flow", () => {
  it("rejects an invalid keyfile with a specific reason before allowing continue", () => {
    const runtime = fakeRuntime();
    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);

    openKeyfileImport();
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: { value: '{"not":"a jwk"}' },
    });

    expect(screen.getByRole("alert").textContent).toContain("isn't a valid Arweave keyfile");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  });

  it("proceeds to the password step once a structurally valid JWK is pasted", () => {
    const runtime = fakeRuntime();
    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);

    openKeyfileImport();
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: {
        value: JSON.stringify({
          kty: "RSA",
          e: "AQAB",
          n: "n".repeat(10),
          d: "d".repeat(10),
          p: "p".repeat(10),
          q: "q".repeat(10),
          dp: "d".repeat(10),
          dq: "d".repeat(10),
          qi: "q".repeat(10),
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Import a wallet")).toBeTruthy();
  });
});

const VALID_JWK = {
  kty: "RSA",
  e: "AQAB",
  n: "n".repeat(10),
  d: "d".repeat(10),
  p: "p".repeat(10),
  q: "q".repeat(10),
  dp: "d".repeat(10),
  dq: "d".repeat(10),
  qi: "q".repeat(10),
};

describe("OnboardingView: add-wallet mode", () => {
  it("starts from an Add wallet screen whose back button cancels", () => {
    const onCancel = vi.fn();
    render(
      <OnboardingView runtime={fakeRuntime()} mode="add-wallet" onComplete={vi.fn()} onCancel={onCancel} />,
    );

    expect(screen.getByText("Add a wallet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("creates with the current password, never asking for a new one, then shows the backup", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-2", name: "Opal" }) // createWallet
      .mockResolvedValueOnce({ ok: true, filename: "wallet-1-arweave-keyfile.json" }); // downloadKeyfile
    const onComplete = vi.fn();
    render(
      <OnboardingView runtime={fakeRuntime({ send })} mode="add-wallet" onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));

    expect(screen.queryByPlaceholderText("Re-enter your password")).toBeNull();
    expect(screen.queryByText("Set a password")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Your wallet is ready")).toBeTruthy());
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "createWallet",
      payload: { name: expect.any(String), password: GOOD_PASSWORD },
    });
    expect(send).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows a wrong-password rejection inline and clears the field", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("That password didn't work. Use the password you unlock Gleam with."));
    render(<OnboardingView runtime={fakeRuntime({ send })} mode="add-wallet" onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));
    const field = screen.getByPlaceholderText("Enter your password");
    fireEvent.change(field, { target: { value: "wrong password here" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("didn't work"));
    expect((screen.getByPlaceholderText("Enter your password") as HTMLInputElement).value).toBe("");
  });

  it("imports a keyfile with the current password and completes", async () => {
    const send = vi.fn().mockResolvedValueOnce({ id: "wallet-3", name: "Jade" });
    const onComplete = vi.fn();
    render(
      <OnboardingView runtime={fakeRuntime({ send })} mode="add-wallet" onComplete={onComplete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import a keyfile" }));
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: { value: JSON.stringify(VALID_JWK) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({
      type: "importWallet",
      payload: { jwk: VALID_JWK, name: expect.any(String), password: GOOD_PASSWORD },
    });
  });
});

describe("OnboardingView: start screens", () => {
  it("asks only new-or-existing on Welcome, keeping import and hardware a step away", () => {
    render(<OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Create a wallet",
      "I already have a wallet",
    ]);
  });

  it("returns from the existing-wallet screen to Welcome, and from import to the existing-wallet screen", () => {
    render(<OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} />);

    openKeyfileImport();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Use an existing wallet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "I already have a wallet" })).toBeTruthy();
  });

  it("returns from import straight to the add-wallet list in add-wallet mode", () => {
    render(<OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} mode="add-wallet" />);

    fireEvent.click(screen.getByRole("button", { name: "Import a keyfile" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Add a wallet")).toBeTruthy();
  });
});

function openHardwareStart(mode: "first-run" | "add-wallet") {
  if (mode === "first-run") fireEvent.click(screen.getByRole("button", { name: "I already have a wallet" }));
}

describe("OnboardingView: Connect Keystone", () => {
  it.each(["first-run", "add-wallet"] as const)("offers it from the %s start", (mode) => {
    const onConnectKeystone = vi.fn();
    render(
      <OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} mode={mode} onConnectKeystone={onConnectKeystone} />,
    );
    openHardwareStart(mode);
    fireEvent.click(screen.getByRole("button", { name: "Keystone" }));
    expect(onConnectKeystone).toHaveBeenCalledOnce();
  });
});

describe("OnboardingView: Connect Ledger", () => {
  it.each(["first-run", "add-wallet"] as const)("offers it from the %s start", (mode) => {
    const onConnectLedger = vi.fn();
    render(
      <OnboardingView runtime={fakeRuntime()} onComplete={vi.fn()} mode={mode} onConnectLedger={onConnectLedger} />,
    );
    openHardwareStart(mode);
    fireEvent.click(screen.getByRole("button", { name: "Ledger" }));
    expect(onConnectLedger).toHaveBeenCalledOnce();
  });
});
