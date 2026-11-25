import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import type { Grant, RuntimePort, WalletSummary } from "@gleam/core";
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
    const send = vi.fn(() => new Promise<Grant[]>(() => {})) as unknown as RuntimePort["send"];
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
    expect(screen.getByText(/can request payments/i)).toBeTruthy();
  });

  it("shows each site's saved icon, and the hostname's first letter when there is none", async () => {
    const send = vi.fn().mockResolvedValue([{ ...GRANT_LIMITED, icon: "https://bazar.arweave.net/logo.png" }, GRANT_UNLIMITED]);
    const { container } = render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("https://bazar.arweave.net/logo.png"));
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByText("U")).toBeTruthy();
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
    expect(screen.getByText(/end this site's access/i)).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "revokeGrant",
        payload: { origin: "https://bazar.arweave.net" },
      }),
    );
    await waitFor(() => expect(screen.getByText(/no apps connected yet/i)).toBeTruthy());
  });

  it("Cancel backs out of a revoke without sending it", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_LIMITED]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/end this site's access/i)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("says so when a revoke fails, and keeps the row", async () => {
    const send = vi.fn().mockResolvedValueOnce([GRANT_LIMITED]).mockRejectedValueOnce(new Error("background unreachable"));
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't revoke/i));
    expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy();
  });

  it("titles a row with the dApp's name, keeping the hostname beneath it", async () => {
    const send = vi.fn().mockResolvedValue([{ ...GRANT_LIMITED, name: "Bazar" }]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Bazar")).toBeTruthy());
    expect(screen.getByText("bazar.arweave.net")).toBeTruthy();
  });

  it("lists each permission when a row is opened", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_UNLIMITED]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    const toggle = await screen.findByRole("button", { name: /show what unknown-app.example can do/i });
    expect(screen.queryByText("Request payments")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("See your address")).toBeTruthy();
    expect(screen.getByText("Request payments")).toBeTruthy();
  });

  it("names each grant's wallet only when there is more than one wallet", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_LIMITED]);
    const wallet = (id: string, name: string): WalletSummary => ({
      id,
      name,
      address: id,
      method: "jwk",
      publicKey: "",
      createdAt: 0,
      updatedAt: 0,
      backupConfirmedAt: null,
    }) as WalletSummary;
    const { rerender } = render(
      <ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} wallets={[wallet("wallet-1", "Main")]} />,
    );

    await waitFor(() => expect(screen.getAllByText("bazar.arweave.net")[0]).toBeTruthy());
    expect(screen.queryByText(/connected to/i)).toBeNull();

    rerender(
      <ConnectedAppsView
        runtime={fakeRuntime({ send })}
        onBack={vi.fn()}
        wallets={[wallet("wallet-1", "Main"), wallet("wallet-2", "Savings")]}
      />,
    );
    expect(screen.getByText(/connected to main/i)).toBeTruthy();
  });

  it("lists the most recently granted site first", async () => {
    const send = vi.fn().mockResolvedValue([GRANT_LIMITED, { ...GRANT_UNLIMITED, createdAt: 5 }]);
    render(<ConnectedAppsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    const toggles = await screen.findAllByRole("button", { name: /show what/i });
    expect(toggles[0]?.getAttribute("aria-label")).toMatch(/unknown-app.example/);
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
