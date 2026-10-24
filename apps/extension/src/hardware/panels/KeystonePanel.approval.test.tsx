import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArweaveSignature } from "@keystonehq/bc-ur-registry-arweave";
import { UR } from "@ngraveio/bc-ur";
import type { DeviceSigningPayload } from "@gleam/core";
import type { QrScannerProps } from "../keystone";
import type { DeviceSignPanelProps } from "@gleam/app/src/approval/device-panels.tsx";
import { createKeystonePanel } from "./KeystonePanel";

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] as const;

beforeEach(() => {
  let next = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => IDS[next++ % IDS.length]!);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const signatureOf = (fill: number) => Buffer.alloc(512, fill);
const signatureUr = (fill: number, id?: string) =>
  new ArweaveSignature(signatureOf(fill), id ? Buffer.from(id.replace(/-/g, ""), "hex") : undefined).toUR();

let lastScanner: QrScannerProps | undefined;
let scannerMounts = 0;
function FakeScanner(props: QrScannerProps) {
  lastScanner = props;
  scannerMounts += 1;
  return <p>fake-scanner</p>;
}
const Panel = createKeystonePanel(FakeScanner);

const dataItem = (byte: number): DeviceSigningPayload => ({
  kind: "dataItem",
  raw: Buffer.alloc(100, byte).toString("base64url"),
});

function renderPanel(overrides: Partial<DeviceSignPanelProps> = {}) {
  const props: DeviceSignPanelProps = {
    payloads: [dataItem(1)],
    wallet: { method: "keystone", device: { kind: "keystone", xfp: "f23f9fd2" }, address: "a".repeat(43), publicKey: "pub" },
    onSignatures: vi.fn(),
    onActivity: vi.fn(),
    onError: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<Panel {...props} />);
  return props;
}

function scan(ur: UR) {
  fireEvent.click(screen.getByRole("button", { name: "Scan Keystone's signature" }));
  expect(lastScanner?.expectedType).toBe("arweave-signature");
  act(() => lastScanner!.onComplete(ur));
}

describe("KeystonePanel", () => {
  it("shows the request QR, then scans the signature and returns it as base64url", () => {
    const props = renderPanel();
    expect(screen.getByText("Scan this with your Keystone")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Signing request for Keystone" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Scan Keystone's signature" }));
    expect(screen.getByText("Confirm on your Keystone, then scan the signature it shows.")).toBeTruthy();
    act(() => lastScanner!.onComplete(signatureUr(9, IDS[0])));

    expect(props.onSignatures).toHaveBeenCalledWith([signatureOf(9).toString("base64url")]);
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("walks a batch item by item and returns the signatures in order", () => {
    const props = renderPanel({ payloads: [dataItem(1), dataItem(2)] });
    expect(screen.getByText("Item 1 of 2")).toBeTruthy();
    scan(signatureUr(1, IDS[0]));

    expect(screen.getByText("Item 2 of 2")).toBeTruthy();
    expect(props.onSignatures).not.toHaveBeenCalled();
    scan(signatureUr(2, IDS[1]));

    expect(props.onSignatures).toHaveBeenCalledWith([
      signatureOf(1).toString("base64url"),
      signatureOf(2).toString("base64url"),
    ]);
  });

  it("refuses a signature for another request and lets the user scan again", () => {
    const props = renderPanel();
    scan(signatureUr(1, IDS[1]));
    expect(screen.getByRole("alert").textContent).toMatch(/different request/);
    expect(props.onSignatures).not.toHaveBeenCalled();

    const mounts = scannerMounts;
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(scannerMounts).toBeGreaterThan(mounts);
    act(() => lastScanner!.onComplete(signatureUr(1, IDS[0])));
    expect(props.onSignatures).toHaveBeenCalledTimes(1);
  });

  it("explains a QR of the wrong type", () => {
    renderPanel();
    scan(new UR(Buffer.from([0x01]), "arweave-crypto-account"));
    expect(screen.getByRole("alert").textContent).toMatch(/not a Keystone signature QR/);
  });

  it("explains a denied camera", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Scan Keystone's signature" }));
    act(() => lastScanner!.onError("camera-denied"));
    expect(screen.getByRole("alert").textContent).toMatch(/set Camera to Allow/);
    fireEvent.click(screen.getByRole("button", { name: "Show the QR again" }));
    expect(screen.getByText("Scan this with your Keystone")).toBeTruthy();
  });

  it("reports scan progress as device activity", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Scan Keystone's signature" }));
    act(() => lastScanner!.onProgress?.(40));
    expect(props.onActivity).toHaveBeenCalled();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  });

  it("refuses a transaction with too much data instead of showing a QR", () => {
    const transaction: DeviceSigningPayload = {
      kind: "transaction",
      transaction: {
        format: 2,
        id: "",
        last_tx: "",
        owner: "pub",
        tags: [],
        target: "",
        quantity: "0",
        data: "",
        data_size: String(300 * 1024),
        data_root: "",
        reward: "0",
        signature: "",
      },
    };
    const props = renderPanel({ payloads: [transaction] });
    expect(props.onError).toHaveBeenCalledWith(expect.stringMatching(/too much to show as a QR/));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("refuses a request too large to show as a QR", () => {
    const raw = Buffer.alloc(400 * 220, 3).toString("base64url");
    const props = renderPanel({ payloads: [{ kind: "dataItem", raw }] });
    expect(props.onError).toHaveBeenCalledWith(expect.stringMatching(/too large to show as a QR/));
  });

  it("refuses a wallet without a master fingerprint", () => {
    const props = renderPanel({
      wallet: { method: "keystone", device: null, address: "a".repeat(43), publicKey: "pub" },
    });
    expect(props.onError).toHaveBeenCalledWith(expect.stringMatching(/master fingerprint/));
  });
});
