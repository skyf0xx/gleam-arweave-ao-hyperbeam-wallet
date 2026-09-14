import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LockSettings, RuntimePort } from "@gleam/core";
import { LockSettingsView } from "./LockSettingsView";

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

const NEVER: LockSettings = { autoLockTimeout: "never" };

describe("LockSettingsView (1.6 lock-settings)", () => {
  it("loads current settings via getLockSettings and marks the active option", async () => {
    const send = vi.fn().mockResolvedValue({ autoLockTimeout: "5min" } satisfies LockSettings);
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("5 minutes")).toBeTruthy());
    expect(send).toHaveBeenCalledWith({ type: "getLockSettings", payload: undefined });
  });

  it("Lock now calls lockWallet then onLocked", async () => {
    const send = vi.fn().mockResolvedValueOnce(NEVER).mockResolvedValueOnce(undefined);
    const onLocked = vi.fn();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={onLocked} />);

    await waitFor(() => expect(screen.getByText("Lock now")).toBeTruthy());
    fireEvent.click(screen.getByText("Lock now"));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "lockWallet", payload: undefined }));
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });

  it("selecting a timeout calls setLockSettings with that value", async () => {
    const send = vi.fn().mockResolvedValueOnce(NEVER).mockResolvedValueOnce(undefined);
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("1 hour")).toBeTruthy());
    fireEvent.click(screen.getByText("1 hour"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "setLockSettings", payload: { autoLockTimeout: "1hr" } }),
    );
  });

  it("does not re-save when the already-selected timeout is tapped again", async () => {
    const send = vi.fn().mockResolvedValue(NEVER);
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Never")).toBeTruthy());
    fireEvent.click(screen.getByText("Never"));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows the network error banner on a failed load", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("unreachable")).mockResolvedValueOnce(NEVER);
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    const send = vi.fn().mockResolvedValue(NEVER);
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={onBack} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Never")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
