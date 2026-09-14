import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NetworkSettings, RuntimePort } from "@gleam/core";
import { NetworkPeersView } from "./NetworkPeersView";

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

const SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: [
    { url: "https://hyperbeam.arweave.net", enabled: true },
    { url: "https://ao-testnet.xyz", enabled: false },
  ],
  activePeerUrl: "https://hyperbeam.arweave.net",
};

describe("NetworkPeersView (7.3 network-peers)", () => {
  it("loads settings via getNetworkSettings and shows the gateway and peer list", async () => {
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy();
    expect(screen.getByText("ao-testnet.xyz")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "getNetworkSettings", payload: undefined });
  });

  it("toggling a peer's enabled switch writes the full NetworkSettings via setNetworkSettings", async () => {
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("ao-testnet.xyz")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "Enable ao-testnet.xyz" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: {
          ...SETTINGS,
          peers: [
            { url: "https://hyperbeam.arweave.net", enabled: true },
            { url: "https://ao-testnet.xyz", enabled: true },
          ],
        },
      }),
    );
  });

  it("disabling the active peer clears activePeerUrl", async () => {
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "Enable hyperbeam.arweave.net" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: {
          ...SETTINGS,
          peers: [
            { url: "https://hyperbeam.arweave.net", enabled: false },
            { url: "https://ao-testnet.xyz", enabled: false },
          ],
          activePeerUrl: null,
        },
      }),
    );
  });

  it("selecting an enabled, non-active peer makes it active", async () => {
    const settingsWithNoActive: NetworkSettings = { ...SETTINGS, activePeerUrl: null };
    const send = vi.fn().mockResolvedValueOnce(settingsWithNoActive).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("hyperbeam.arweave.net"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: { ...settingsWithNoActive, activePeerUrl: "https://hyperbeam.arweave.net" },
      }),
    );
  });

  it("does not activate a disabled peer when its row is tapped", async () => {
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("ao-testnet.xyz")).toBeTruthy());
    fireEvent.click(screen.getByText("ao-testnet.xyz"));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("removing a peer drops it from the list and clears activePeerUrl if it was active", async () => {
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove hyperbeam.arweave.net" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: {
          ...SETTINGS,
          peers: [{ url: "https://ao-testnet.xyz", enabled: false }],
          activePeerUrl: null,
        },
      }),
    );
  });

  it("adding a peer normalizes the URL and appends it enabled by default", async () => {
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), {
      target: { value: "new-peer.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: {
          ...SETTINGS,
          peers: [...SETTINGS.peers, { url: "https://new-peer.example.com", enabled: true }],
        },
      }),
    );
  });

  it("rejects an invalid peer URL without calling setNetworkSettings", async () => {
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Enter a valid peer URL.")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate peer URL without calling setNetworkSettings", async () => {
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), {
      target: { value: "hyperbeam.arweave.net" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("That peer is already in the list.")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows the network error banner on a failed load and retries", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("unreachable")).mockResolvedValueOnce(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy());
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={onBack} />);

    await waitFor(() => expect(screen.getByText("hyperbeam.arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
