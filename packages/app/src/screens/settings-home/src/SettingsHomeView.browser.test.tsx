import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeAppPlatform, renderWithPlatform } from "../../../app-platform/testing";
import { SettingsHomeView } from "./SettingsHomeView";

afterEach(() => {
  cleanup();
});

function mount(dappBrowser: boolean) {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type === "getLockSettings") return { autoLockTimeout: "never" };
    if (type === "getNetworkSettings") return { gatewayUrl: "https://arweave.net", peers: [], activePeerUrl: null };
    if (type === "getThemePreference") return { theme: "light" };
    if (type === "getDisplaySettings") return { currency: "USD", showChart: true, showTokenLogos: false, headline: "total", balancesHidden: false };
    if (type === "getScanStats") return null;
    return undefined;
  });
  const clearSiteData = vi.fn(async () => {});
  const runtime = { send, onMessage: () => () => {} } as unknown as RuntimePort;
  const platform = fakeAppPlatform({
    runtime,
    capabilities: { dappBrowser },
    dappBrowser: {
      open: async () => {},
      close: async () => {},
      goBack: async () => {},
      reload: async () => {},
      setFrame: async () => {},
      setHidden: async () => {},
      clearSiteData,
      subscribe: () => () => {},
    },
  });
  renderWithPlatform(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsHomeView
        runtime={runtime}
        onBack={vi.fn()}
        onOpenConnectedApps={vi.fn()}
        onOpenNetworkPeers={vi.fn()}
        onOpenManageTokens={vi.fn()}
        onOpenContacts={vi.fn()}
        onOpenDisplayCurrency={vi.fn()}
        onOpenUpload={vi.fn()}
        onOpenFeedback={vi.fn()}
      />
    </QueryClientProvider>,
    platform,
  );
  return { send, clearSiteData };
}

describe("SettingsHomeView browser actions", () => {
  it("clears recent sites and site data", async () => {
    const { send, clearSiteData } = mount(true);
    fireEvent.click(await screen.findByText("Clear recent sites"));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "clearRecentSites", payload: undefined }));
    fireEvent.click(screen.getByText("Clear site data"));
    await waitFor(() => expect(clearSiteData).toHaveBeenCalled());
    expect(await screen.findAllByText("Cleared")).toHaveLength(2);
  });

  it("leaves the actions out where the host has no browser", async () => {
    mount(false);
    await screen.findByText("Settings");
    expect(screen.queryByText("Clear recent sites")).toBeNull();
  });
});
