import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { UnlockView } from "./UnlockView";

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

describe("UnlockView", () => {
  it("shows no per-wallet identity — no avatar, name, or address text on screen", () => {
    const runtime = fakeRuntime();
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("gleam")).toBeTruthy();
    expect(screen.queryByText(/wallet 1|0x|address/i)).toBeNull();
  });

  it("calls unlockWallet with the entered password and onUnlocked on success", async () => {
    const send = vi.fn().mockResolvedValue({ unlockedWalletIds: ["wallet-1"] });
    const runtime = fakeRuntime({ send });
    const onUnlocked = vi.fn();

    render(<UnlockView runtime={runtime} onUnlocked={onUnlocked} onResetComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({
      type: "unlockWallet",
      payload: { password: "correct horse battery staple" },
    });
  });

  it("shows a direct error message on unlock failure, without an apology", async () => {
    const send = vi.fn().mockRejectedValue(new Error("That password didn't work. Try again, or use your recovery method."));
    const runtime = fakeRuntime({ send });

    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "wrong password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("didn't work"),
    );
  });

  it("forgot-password link leads to the explicit destructive reset screen, not a silent delete", () => {
    const runtime = fakeRuntime();
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.getByText("Forgot password?", { selector: "h2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset wallet" })).toBeTruthy();
  });

  it("requires a second confirmation tap before the reset actually fires", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onResetComplete = vi.fn();
    const runtime = fakeRuntime({ send });
    render(
      <UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={onResetComplete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset wallet" }));
    expect(onResetComplete).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, reset wallet" }));
    await waitFor(() => expect(onResetComplete).toHaveBeenCalledOnce());
  });

  it("resetting a wallet calls the real resetAllWallets RPC and only completes once it resolves", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onResetComplete = vi.fn();
    const runtime = fakeRuntime({ send });
    render(
      <UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={onResetComplete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset wallet" }));

    expect(send).toHaveBeenCalledWith({ type: "resetAllWallets", payload: undefined });
    await waitFor(() => expect(onResetComplete).toHaveBeenCalledOnce());
  });

  it("shows a real error and never completes the reset when the RPC call is rejected", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Couldn't reach the background service."));
    const onResetComplete = vi.fn();
    const runtime = fakeRuntime({ send });
    render(
      <UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={onResetComplete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset wallet" }));

    await waitFor(() =>
      expect(screen.getByText("Couldn't reach the background service.")).toBeTruthy(),
    );
    expect(onResetComplete).not.toHaveBeenCalled();
  });

  it("cancel from forgot-password returns to the unlock screen", () => {
    const runtime = fakeRuntime();
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
  });
});
