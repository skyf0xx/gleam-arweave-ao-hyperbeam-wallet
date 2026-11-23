import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import type { AppPlatform } from "../../../app-platform/types";
import type { DisplaySettings, LockSettings, NetworkSettings, RuntimePort, ThemeSettings } from "@gleam/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsHomeView } from "./SettingsHomeView";
import { AppearanceView } from "./AppearanceView";
import { ThemeContext } from "../../../theme";

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
const DISPLAY_SETTINGS: DisplaySettings = { currency: "EUR", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: false };

function successfulSend(overrides: { theme?: ThemeSettings["theme"]; setTheme?: () => unknown } = {}): RuntimePort["send"] {
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getLockSettings") return LOCK_SETTINGS;
    if (type === "getNetworkSettings") return NETWORK_SETTINGS;
    if (type === "getThemePreference") return { theme: overrides.theme ?? "light" } satisfies ThemeSettings;
    if (type === "setThemePreference") return overrides.setTheme?.();
    if (type === "getScanStats") return null;
    if (type === "getDisplaySettings") return DISPLAY_SETTINGS;
    if (type === "setDisplaySettings") return undefined;
    if (type === "getConnectedApps") return [{}, {}, {}];
    throw new Error(`Unexpected message type "${type}"`);
  }) as RuntimePort["send"];
}

function renderSettingsHome(overrides: Partial<Parameters<typeof SettingsHomeView>[0]> = {}, platform?: AppPlatform) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsHomeView
        runtime={fakeRuntime({ send: successfulSend() })}
        onBack={vi.fn()}
        onOpenLockSettings={vi.fn()}
        onOpenConnectedApps={vi.fn()}
        onOpenAppearance={vi.fn()}
        onOpenNetworkPeers={vi.fn()}
        onOpenFeedback={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
    platform,
  );
}

describe("SettingsHomeView", () => {
  it("moves the wallet to the side panel from the header", async () => {
    const toggle = vi.fn(async () => {});
    renderSettingsHome({}, fakeAppPlatform({ sidePanel: { docked: false, toggle } }));

    fireEvent.click(screen.getByRole("button", { name: "Open in side panel" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
  });

  it("offers the popup from the side panel", async () => {
    renderSettingsHome({}, fakeAppPlatform({ sidePanel: { docked: true, toggle: vi.fn(async () => {}) } }));

    expect(screen.getByRole("button", { name: "Open as popup" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
  });

  it("has no side panel button where the host has no side panel", async () => {
    renderSettingsHome();

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open in side panel" })).toBeNull();
  });

  it("shows the auto-lock time on Security and the gateway on Network", async () => {
    renderSettingsHome();

    await waitFor(() => expect(within(screen.getByRole("button", { name: "Security" })).getByText("Auto-lock off")).toBeTruthy());
    expect(within(screen.getByRole("button", { name: "Network" })).getByText("arweave.net")).toBeTruthy();
  });

  it("counts connected apps on their row, which opens them", async () => {
    const onOpenConnectedApps = vi.fn();
    renderSettingsHome({ onOpenConnectedApps });

    const apps = screen.getByRole("button", { name: "Connected apps" });
    await waitFor(() => expect(within(apps).getByText("3")).toBeTruthy());
    fireEvent.click(apps);
    expect(onOpenConnectedApps).toHaveBeenCalledTimes(1);
  });

  it("drops Security when the vault has no password", async () => {
    renderSettingsHome({ onOpenLockSettings: undefined });

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Security" })).toBeNull();
  });

  it("opens Security, Appearance and Network from their rows", async () => {
    const onOpenLockSettings = vi.fn();
    const onOpenAppearance = vi.fn();
    const onOpenNetworkPeers = vi.fn();
    renderSettingsHome({ onOpenLockSettings, onOpenAppearance, onOpenNetworkPeers });

    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Network" }));

    expect(onOpenLockSettings).toHaveBeenCalledTimes(1);
    expect(onOpenAppearance).toHaveBeenCalledTimes(1);
    expect(onOpenNetworkPeers).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
  });

  it("shows the currency and language on Appearance", async () => {
    renderSettingsHome();

    await waitFor(() => expect(within(screen.getByRole("button", { name: "Appearance" })).getByText("EUR · English")).toBeTruthy());
  });

  it("Dark persists the choice and applies it at once", async () => {
    const send = successfulSend({ theme: "light" });
    renderSettingsHome({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "setThemePreference", payload: { theme: "dark" } }));
  });

  it("flips the theme App's root reads from, starting from dark", async () => {
    const setTheme = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeContext.Provider value={{ theme: "dark", setTheme }}>
          <SettingsHomeView
            runtime={fakeRuntime({ send: successfulSend({ theme: "dark" }) })}
            onBack={vi.fn()}
            onOpenLockSettings={vi.fn()}
                onOpenConnectedApps={vi.fn()}
            onOpenAppearance={vi.fn()}
            onOpenNetworkPeers={vi.fn()}
            onOpenFeedback={vi.fn()}
          />
        </ThemeContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(setTheme).toHaveBeenCalledWith("light");
    await waitFor(() => expect((screen.getByRole("radio", { name: "Light" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("puts the theme back if saving it fails", async () => {
    const send = successfulSend({
      setTheme: () => {
        throw new Error("write failed");
      },
    });
    renderSettingsHome({ runtime: fakeRuntime({ send }) });

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getThemePreference", payload: undefined }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "setThemePreference", payload: { theme: "dark" } }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("opens feedback from its row", async () => {
    const onOpenFeedback = vi.fn();
    renderSettingsHome({ onOpenFeedback });

    fireEvent.click(screen.getByRole("button", { name: "Send us feedback" }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    renderSettingsHome({ onBack });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
  });
});

describe("AppearanceView", () => {
  it("opens currency, language and home screen", async () => {
    const onOpenDisplayCurrency = vi.fn();
    const onOpenLanguage = vi.fn();
    const onOpenHomeScreen = vi.fn();
    const send = successfulSend();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppearanceView
          runtime={fakeRuntime({ send })}
          onBack={vi.fn()}
          onOpenDisplayCurrency={onOpenDisplayCurrency}
          onOpenLanguage={onOpenLanguage}
          onOpenHomeScreen={onOpenHomeScreen}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(within(screen.getByRole("button", { name: "Currency" })).getByText("EUR")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Currency" }));
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByRole("button", { name: "Home screen" }));
    expect(onOpenDisplayCurrency).toHaveBeenCalledTimes(1);
    expect(onOpenLanguage).toHaveBeenCalledTimes(1);
    expect(onOpenHomeScreen).toHaveBeenCalledTimes(1);
  });
});
