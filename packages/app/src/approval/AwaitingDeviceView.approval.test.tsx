import { useEffect, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  WALLET_APPROVAL_ORIGIN,
  type ApprovalRequest,
  type DeviceSigningRequest,
  type RuntimePort,
  type ThemeSettings,
  type WalletState,
} from "@gleam/core";
import { AwaitingDeviceView, DEVICE_HEARTBEAT_MS } from "./AwaitingDeviceView";
import { ApprovalRoot } from "./ApprovalRoot";
import { fakeAppPlatform, platformWrapper } from "../app-platform/testing";
import { type DeviceSignPanel, type DeviceSignPanelProps } from "./device-panels";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DEVICE: DeviceSigningRequest = {
  method: "ledger",
  device: { kind: "ledger" },
  address: "a".repeat(43),
  publicKey: "pub",
  payloads: [{ kind: "dataItem", raw: "AQID" }],
  summaries: [{ kind: "dataItem", target: null, dataSize: 3 }],
  deadline: 0,
};

/** A panel the test drives by hand through the props it was last rendered with. */
function controllablePanel() {
  const renders: DeviceSignPanelProps[] = [];
  let mounts = 0;
  const Panel: DeviceSignPanel = (props) => {
    renders.push(props);
    useEffect(() => {
      mounts += 1;
    }, []);
    return <p>Test panel</p>;
  };
  return { Panel, last: () => renders[renders.length - 1]!, mounts: () => mounts };
}

function renderView(overrides: Partial<Parameters<typeof AwaitingDeviceView>[0]> = {}) {
  const panel = controllablePanel();
  const props = {
    origin: "https://bazar.arweave.net",
    device: DEVICE,
    Panel: panel.Panel,
    onSubmit: vi.fn(async () => {}),
    onCancel: vi.fn(),
    onActivity: vi.fn(async () => ({ deadline: 0 })),
    ...overrides,
  };
  render(<AwaitingDeviceView {...props} />);
  return { props, panel };
}

describe("AwaitingDeviceView", () => {
  it("names the device and the signing address, and hands the panel the payloads and wallet", () => {
    const { panel } = renderView();
    expect(screen.getByText("Confirm on your Ledger")).toBeTruthy();
    expect(screen.getByText(DEVICE.address)).toBeTruthy();
    expect(screen.getByText("Test panel")).toBeTruthy();
    expect(panel.last().payloads).toEqual(DEVICE.payloads);
    expect(panel.last().wallet).toEqual({ method: "ledger", device: { kind: "ledger" }, address: DEVICE.address, publicKey: "pub" });
  });

  it("shows what the payloads actually sign above the panel", () => {
    renderView({
      device: {
        ...DEVICE,
        payloads: [
          { kind: "dataItem", raw: "AQID" },
          { kind: "dataItem", raw: "BAUG" },
        ],
        summaries: [
          { kind: "transaction", recipient: "r".repeat(43), quantity: "1000000000000", fee: "2000000000", dataSize: "0" },
          { kind: "aoTransfer", process: "p".repeat(43), recipient: "q".repeat(43), quantity: "2500000" },
        ],
      },
      token: { processId: "p".repeat(43), denomination: 6, ticker: "ARDRIVE" },
    });
    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(screen.getByText("r".repeat(43))).toBeTruthy();
    expect(screen.getByText("1 AR")).toBeTruthy();
    expect(screen.getByText("0.002 AR")).toBeTruthy();
    expect(screen.getByText("p".repeat(43))).toBeTruthy();
    expect(screen.getByText("2.5 ARDRIVE")).toBeTruthy();
  });

  it("shows an L1 token transfer's AR fee, and calls a target the preview didn't resolve an unknown token", () => {
    renderView({
      device: {
        ...DEVICE,
        payloads: [{ kind: "dataItem", raw: "AQID" }],
        summaries: [{ kind: "l1TokenTransfer", process: "z".repeat(43), recipient: "q".repeat(43), quantity: "311", fee: "654321" }],
      },
      token: { processId: "p".repeat(43), denomination: 6, ticker: "ARDRIVE" },
    });
    expect(screen.getByText("Unknown token")).toBeTruthy();
    expect(screen.getByText("311 smallest units")).toBeTruthy();
    expect(screen.getByText("0.000000654321 AR")).toBeTruthy();
  });

  it("shows Gleam, not a hostname, for a send from the wallet itself", () => {
    renderView({ origin: WALLET_APPROVAL_ORIGIN, device: { ...DEVICE, method: "keystone", device: { kind: "keystone", xfp: "1" } } });
    expect(screen.getByText("Gleam")).toBeTruthy();
    expect(screen.getByText("Confirm on your Keystone")).toBeTruthy();
  });

  it("submits the panel's signatures", async () => {
    const { props, panel } = renderView();
    act(() => panel.last().onSignatures(["sig"]));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith(["sig"]));
  });

  it("shows a refused signature, and Try again remounts the panel", async () => {
    const onSubmit = vi
      .fn<(signatures: string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The signature doesn't match this wallet."))
      .mockResolvedValueOnce(undefined);
    const { panel } = renderView({ onSubmit });

    act(() => panel.last().onSignatures(["bad"]));
    expect((await screen.findByRole("alert")).textContent).toMatch(/doesn't match this wallet/);
    expect(screen.queryByText("Test panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Test panel")).toBeTruthy();
    expect(panel.mounts()).toBe(2);
    act(() => panel.last().onSignatures(["good"]));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith(["good"]));
  });

  it("shows a device error from the panel with a retry", async () => {
    const { panel } = renderView();
    act(() => panel.last().onError("The Ledger was disconnected."));
    expect(screen.getByRole("alert").textContent).toBe("The Ledger was disconnected.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("reports activity on its own timer while mounted, and whenever the panel does", async () => {
    vi.useFakeTimers();
    const { props, panel } = renderView();
    await act(() => vi.advanceTimersByTimeAsync(DEVICE_HEARTBEAT_MS * 2));
    expect(props.onActivity).toHaveBeenCalledTimes(2);
    act(() => panel.last().onActivity());
    expect(props.onActivity).toHaveBeenCalledTimes(3);

    cleanup();
    await vi.advanceTimersByTimeAsync(DEVICE_HEARTBEAT_MS * 2);
    expect(props.onActivity).toHaveBeenCalledTimes(3);
  });

  it("Cancel, from the view or the panel, rejects the request", () => {
    const { props, panel } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => panel.last().onCancel());
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("ApprovalRoot with a hardware wallet", () => {
  const REQUEST: ApprovalRequest = {
    requestId: "req-hw",
    origin: "https://bazar.arweave.net",
    kind: "signDataItem",
    preview: {
      kind: "signDataItem",
      recipient: null,
      amount: null,
      fee: null,
      token: null,
      tokenDenomination: null,
      tokenTicker: null,
      decodedData: "hello",
      tags: [],
      payloadHash: "ab".repeat(32),
      items: null,
    },
    createdAt: 0,
  };

  const STATE: WalletState = {
    wallets: [
      {
        id: "hw-1",
        address: DEVICE.address,
        name: "Ledger",
        method: "ledger",
        publicKey: "pub",
        createdAt: 0,
        updatedAt: 0,
        backupConfirmedAt: null,
      },
    ],
    activeWalletId: "hw-1",
    session: { unlockedAt: 0, lastActivityAt: 0, autoLockTimeout: "never", unlockedWalletIds: ["hw-1"] },
  };

  function runtimeFor(initial: ApprovalRequest) {
    const send = vi.fn(async (message: { type: string; payload: unknown }) => {
      if (message.type === "getState") return STATE;
      if (message.type === "getApproval") return initial;
      if (message.type === "getThemePreference") return { theme: "light" } satisfies ThemeSettings;
      if (message.type === "resolveApproval") {
        return (message.payload as { approved: boolean }).approved ? { ...REQUEST, device: DEVICE } : undefined;
      }
      if (message.type === "submitDeviceSignature") return undefined;
      if (message.type === "deviceActivity") return { deadline: 0 };
      throw new Error(`unexpected message ${message.type}`);
    });
    const runtime: RuntimePort = { send: send as never, onMessage: vi.fn(() => () => {}) };
    return { runtime, send };
  }

  const IdlePanel: DeviceSignPanel = () => <p>Idle panel</p>;

  function renderRoot(ui: ReactElement, panel: DeviceSignPanel = IdlePanel) {
    const signPanels = { keystone: panel, ledger: panel };
    return render(ui, {
      wrapper: platformWrapper(fakeAppPlatform({ hardwareWallets: { openConnectPage: async () => {}, signPanels } })),
    });
  }

  /** Signs as soon as it mounts, as a device would once the user confirms. */
  const SigningPanel: DeviceSignPanel = ({ onSignatures }) => {
    useEffect(() => onSignatures(["c2ln"]), [onSignatures]);
    return <p>Test panel</p>;
  };

  it("moves from the preview to the device step on approval, then submits the device's signatures", async () => {
    const { runtime, send } = runtimeFor(REQUEST);
    renderRoot(<ApprovalRoot requestId="req-hw" runtime={runtime} />, SigningPanel);

    fireEvent.click(await screen.findByRole("button", { name: "Sign message" }));

    expect(await screen.findByText("Signed.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({
      type: "submitDeviceSignature",
      payload: { requestId: "req-hw", signatures: ["c2ln"] },
    });
  });

  it("opens straight on the device step when the request already waits for it", async () => {
    const { runtime } = runtimeFor({ ...REQUEST, device: DEVICE });
    renderRoot(<ApprovalRoot requestId="req-hw" runtime={runtime} />);
    expect(await screen.findByText("Confirm on your Ledger")).toBeTruthy();
  });

  it("Cancel on the device step rejects the request", async () => {
    const { runtime, send } = runtimeFor({ ...REQUEST, device: DEVICE });
    renderRoot(<ApprovalRoot requestId="req-hw" runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Request rejected.")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "resolveApproval", payload: { requestId: "req-hw", approved: false } });
  });
});
