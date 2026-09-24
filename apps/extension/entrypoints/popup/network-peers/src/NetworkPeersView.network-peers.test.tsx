import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NetworkSettings, RuntimePort } from "@gleam/core";
import { NetworkPeersView } from "./NetworkPeersView";

const { permissionsRequest, permissionsContains, sessionStore } = vi.hoisted(() => ({
  permissionsRequest: vi.fn(),
  permissionsContains: vi.fn(),
  sessionStore: new Map<string, unknown>(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    permissions: { request: permissionsRequest, contains: permissionsContains },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStore.get(key) })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) sessionStore.set(key, value);
        }),
        remove: vi.fn(async (key: string) => {
          sessionStore.delete(key);
        }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  permissionsRequest.mockReset();
  permissionsContains.mockReset();
  sessionStore.clear();
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

  it("editing the gateway requests host permission, checks it's an Arweave gateway, and persists the normalized https URL", async () => {
    permissionsRequest.mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ network: "arweave.N.1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "https://ar-io.example.net/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://ar-io.example.net/*"] }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("https://ar-io.example.net/info", { method: "GET" }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: { ...SETTINGS, gatewayUrl: "https://ar-io.example.net" },
      }),
    );
    vi.unstubAllGlobals();
  });

  it("saves the pending edit to session storage before requesting permission", async () => {
    permissionsRequest.mockImplementation(async () => {
      // At the moment the permission prompt would show, the draft must
      // already be recorded — this is the only chance before Chrome could
      // close the popup.
      expect(sessionStore.get("session:pendingNetworkEdit")).toEqual({
        kind: "gateway",
        url: "https://ar-io.example.net",
      });
      return true;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ network: "arweave.N.1" }) }),
    );
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "https://ar-io.example.net" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(permissionsRequest).toHaveBeenCalled());
    // Cleared again once the flow finishes successfully.
    await waitFor(() => expect(sessionStore.get("session:pendingNetworkEdit")).toBeUndefined());
    vi.unstubAllGlobals();
  });

  it("on remount with a pending gateway edit and the permission now granted, finishes the flow automatically", async () => {
    sessionStore.set("session:pendingNetworkEdit", { kind: "gateway", url: "https://ar-io.example.net" });
    permissionsContains.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ network: "arweave.N.1" }) }),
    );
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() =>
      expect(permissionsContains).toHaveBeenCalledWith({ origins: ["https://ar-io.example.net/*"] }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "setNetworkSettings",
        payload: { ...SETTINGS, gatewayUrl: "https://ar-io.example.net" },
      }),
    );
    await waitFor(() => expect(sessionStore.get("session:pendingNetworkEdit")).toBeUndefined());
    // No editor was ever opened — the flow ran automatically.
    expect(screen.queryByPlaceholderText("https://arweave.net")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("on remount with a pending gateway edit and the permission not granted, reopens the editor pre-filled", async () => {
    sessionStore.set("session:pendingNetworkEdit", { kind: "gateway", url: "https://ar-io.example.net" });
    permissionsContains.mockResolvedValue(false);
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() =>
      expect(permissionsContains).toHaveBeenCalledWith({ origins: ["https://ar-io.example.net/*"] }),
    );
    await waitFor(() =>
      expect((screen.getByPlaceholderText("https://arweave.net") as HTMLInputElement).value).toBe(
        "https://ar-io.example.net",
      ),
    );
    await waitFor(() => expect(sessionStore.get("session:pendingNetworkEdit")).toBeUndefined());
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setNetworkSettings" }));
  });

  it("rejects a non-https gateway URL without requesting permission or persisting", async () => {
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "http://insecure.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a valid https:// gateway URL.")).toBeTruthy();
    expect(permissionsRequest).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not persist an unreachable gateway even after permission is granted", async () => {
    permissionsRequest.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "https://dead-gateway.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("That URL didn't answer as an Arweave gateway…")).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setNetworkSettings" }));
    vi.unstubAllGlobals();
  });

  it("rejects a reachable but non-Arweave host as a gateway", async () => {
    permissionsRequest.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "ok" }) }),
    );
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "https://google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("That URL didn't answer as an Arweave gateway…")).toBeTruthy(),
    );
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setNetworkSettings" }));
    vi.unstubAllGlobals();
  });

  it("denied host permission on gateway edit leaves the gateway unchanged", async () => {
    permissionsRequest.mockResolvedValue(false);
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("arweave.net")).toBeTruthy());
    fireEvent.click(screen.getByText("arweave.net"));
    fireEvent.change(screen.getByPlaceholderText("https://arweave.net"), {
      target: { value: "https://other-gateway.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Permission denied for that origin — the gateway was not changed.")).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledTimes(1);
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

  it("hides the remove control for the hardcoded default peer and leaves it in the list on a direct remove attempt", async () => {
    const hardcodedSettings: NetworkSettings = {
      gatewayUrl: "https://arweave.net",
      peers: [
        { url: "https://state.forward.computer", enabled: true },
        { url: "https://ao-testnet.xyz", enabled: false },
      ],
      activePeerUrl: "https://state.forward.computer",
    };
    const send = vi.fn().mockResolvedValueOnce(hardcodedSettings);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("state.forward.computer")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Remove state.forward.computer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove ao-testnet.xyz" })).toBeTruthy();
    // The enable/disable toggle must stay available for the hardcoded peer.
    expect(screen.getByRole("switch", { name: "Enable state.forward.computer" })).toBeTruthy();
  });

  it("adding a peer requests permission for its origin, and on grant normalizes the URL and appends it enabled by default", async () => {
    permissionsRequest.mockResolvedValue(true);
    const send = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(undefined);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), {
      target: { value: "new-peer.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://new-peer.example.com/*"] }),
    );
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

  it("adding a peer whose origin permission is denied does not persist it and shows a specific error", async () => {
    permissionsRequest.mockResolvedValue(false);
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), {
      target: { value: "denied-peer.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://denied-peer.example.com/*"] }),
    );
    await waitFor(() =>
      expect(screen.getByText("Permission denied for that origin — the peer was not added.")).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setNetworkSettings" }));
  });

  it("adding a peer whose permission request rejects does not persist it and shows a specific error", async () => {
    permissionsRequest.mockRejectedValue(new Error("boom"));
    const send = vi.fn().mockResolvedValue(SETTINGS);
    render(<NetworkPeersView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Add peer")).toBeTruthy());
    fireEvent.click(screen.getByText("Add peer"));
    fireEvent.change(screen.getByPlaceholderText("hyperbeam.example.com"), {
      target: { value: "rejects-peer.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(screen.getByText("Permission denied for that origin — the peer was not added.")).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setNetworkSettings" }));
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
