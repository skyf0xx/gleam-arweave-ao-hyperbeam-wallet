import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Grant, RuntimePort } from "@gleam/core";
import { ConnectedAppsView } from "./ConnectedAppsView";

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

const GRANT_LIMITED: Grant = {
  origin: "https://bazar.arweave.net",
  walletId: "wallet-1",
  permissions: ["ACCESS_ADDRESS"],
  createdAt: 0,
  expiresAt: null,
  budget: null,
};

const GRANT_UNLIMITED: Grant = {
  origin: "https://unknown-app.example",
  walletId: "wallet-1",
  permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
  createdAt: 0,
  expiresAt: null,
  budget: null,
};

describe("ConnectedAppsView (6.3 connected-apps)", () => {
  it("shows skeleton rows (shared loading primitive) while the Grant list loads", () => {
    const send = vi.fn(() => new Promise<Grant[]>(() => {}));
    const { container } = render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    expect(container.querySelectorAll(".gleam-shimmer").length).toBeGreaterThan(0);
  });

  it("shows the empty state copy from connected-apps.html when no Grants exist", async () => {
    const send = vi.fn().mockResolvedValue([]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/no apps connected yet/i)).toBeTruthy());
    expect(send).toHaveBeenCalledWith({ type: "getConnectedApps", payload: undefined });
  });

  it("lists every connected Grant with its origin and scope summary", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_LIMITED, GRANT_UNLIMITED]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    expect(screen.getByText(/sees your address only/i)).toBeTruthy();
    expect(screen.getByText(/spend with no limit/i)).toBeTruthy();
  });

  it("Revoke calls revokeGrant with the row's origin, then reloads the list", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce([GRANT_LIMITED])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "revokeGrant",
        payload: { origin: "https://bazar.arweave.net" },
      }),
    );
    await waitFor(() => expect(screen.getByText(/no apps connected yet/i)).toBeTruthy());
  });

  it("never uses the word 'disconnect' for the revoke action (brand vocabulary rule)", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_LIMITED]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    expect(screen.queryByText(/disconnect/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("surfaces a load failure via the shared network error banner rather than hanging or crashing", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("background unreachable")).mockResolvedValueOnce([]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText(/no apps connected yet/i)).toBeTruthy());
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    const send = vi.fn().mockResolvedValue([]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={onBack} />);

    await waitFor(() => expect(screen.getByText(/no apps connected yet/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
