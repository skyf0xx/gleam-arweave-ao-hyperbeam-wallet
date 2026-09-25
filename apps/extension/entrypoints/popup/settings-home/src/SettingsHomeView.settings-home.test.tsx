import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LockSettings, NetworkSettings, RuntimePort, ThemeSettings } from "@gleam/core";
import { SettingsHomeView } from "./SettingsHomeView";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

const LOCK_SETTINGS: LockSettings = { autoLockTimeout: "never" };
const NETWORK_SETTINGS: NetworkSettings = { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };

function successfulSend(overrides: { theme?: ThemeSettings["theme"] } = {}): RuntimePort["send"] {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getLockSettings") return LOCK_SETTINGS;
    if (type === "getNetworkSettings") return NETWORK_SETTINGS;
    if (type === "getThemePreference") return { theme: overrides.theme ?? "light" } satisfies ThemeSettings;
    if (type === "setThemePreference") return undefined;
    throw new Error(`Unexpected message type "${type}"`);
  }) as RuntimePort["send"];
}

function renderSettingsHome(overrides: Partial<Parameters<typeof SettingsHomeView>[0]> = {}) {
  return render(
    <SettingsHomeView
      runtime={fakeRuntime({ send: successfulSend() })}
      onBack={vi.fn()}
      onOpenLockSettings={vi.fn()}
      onOpenConnectedApps={vi.fn()}
      onOpenNetworkPeers={vi.fn()}
      onOpenManageTokens={vi.fn()}
      onOpenContacts={vi.fn()}
      onOpenUpload={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SettingsHomeView", () => {
  it("shows the current auto-lock and gateway values as row labels", async () => {
    renderSettingsHome();

    await waitFor(() => expect(screen.getByText("Never")).toBeTruthy());
    expect(screen.getByText("arweave.net")).toBeTruthy();
  });

  it("calls onOpenLockSettings when the Auto-lock row is pressed", async () => {
    const onOpenLockSettings = vi.fn();
    renderSettingsHome({ onOpenLockSettings });

    await waitFor(() => expect(screen.getByText("Auto-lock")).toBeTruthy());
    fireEvent.click(screen.getByText("Auto-lock"));

    expect(onOpenLockSettings).toHaveBeenCalled();
  });

  it("calls onOpenConnectedApps when the Connected apps row is pressed", async () => {
    const onOpenConnectedApps = vi.fn();
    renderSettingsHome({ onOpenConnectedApps });

    await waitFor(() => expect(screen.getByText("Connected apps")).toBeTruthy());
    fireEvent.click(screen.getByText("Connected apps"));

    expect(onOpenConnectedApps).toHaveBeenCalled();
  });

  it("calls onOpenNetworkPeers when the Network & peers row is pressed", async () => {
    const onOpenNetworkPeers = vi.fn();
    renderSettingsHome({ onOpenNetworkPeers });

    await waitFor(() => expect(screen.getByText("Network & peers")).toBeTruthy());
    fireEvent.click(screen.getByText("Network & peers"));

    expect(onOpenNetworkPeers).toHaveBeenCalled();
  });

  it("calls onOpenManageTokens when the Manage tokens row is pressed", async () => {
    const onOpenManageTokens = vi.fn();
    renderSettingsHome({ onOpenManageTokens });

    await waitFor(() => expect(screen.getByText("Manage tokens")).toBeTruthy());
    fireEvent.click(screen.getByText("Manage tokens"));

    expect(onOpenManageTokens).toHaveBeenCalled();
  });

  it("calls onOpenContacts when the Contacts row is pressed", async () => {
    const onOpenContacts = vi.fn();
    renderSettingsHome({ onOpenContacts });

    await waitFor(() => expect(screen.getByText("Contacts")).toBeTruthy());
    fireEvent.click(screen.getByText("Contacts"));

    expect(onOpenContacts).toHaveBeenCalled();
  });

  it("shows the Upload to Arweave row as disabled with a Coming soon label and never calls onOpenUpload", async () => {
    const onOpenUpload = vi.fn();
    renderSettingsHome({ onOpenUpload });

    await waitFor(() => expect(screen.getByText("Upload to Arweave")).toBeTruthy());
    expect(screen.getByText("Coming soon")).toBeTruthy();

    const row = screen.getByText("Upload to Arweave").closest("button") as HTMLButtonElement;
    expect(row.disabled).toBe(true);

    fireEvent.click(row);

    expect(onOpenUpload).not.toHaveBeenCalled();
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    renderSettingsHome({ onBack });

    await waitFor(() => expect(screen.getByText("Auto-lock")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalled();
  });

  it("flipping the Dark mode toggle persists via setThemePreference and applies data-theme immediately", async () => {
    const send = successfulSend({ theme: "light" });
    renderSettingsHome({ runtime: fakeRuntime({ send }) });

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
      if (type === "getLockSettings") return LOCK_SETTINGS;
      if (type === "getNetworkSettings") return NETWORK_SETTINGS;
      if (type === "getThemePreference") return { theme: "light" } satisfies ThemeSettings;
      if (type === "setThemePreference") throw new Error("write failed");
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];
    renderSettingsHome({ runtime: fakeRuntime({ send }) });

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

  it("disables Import & export and About rows (no destination screen yet)", async () => {
    renderSettingsHome();

    await waitFor(() => expect(screen.getByText("Import & export")).toBeTruthy());
    expect((screen.getByText("Import & export").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("About").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
