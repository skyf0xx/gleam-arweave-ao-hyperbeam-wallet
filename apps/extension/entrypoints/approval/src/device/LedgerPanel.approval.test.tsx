import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  addressFromOwner,
  base64UrlToBytes,
  bytesToBase64Url,
  generateJWK,
  LEDGER_PERMAWEB_REQUIRED_MESSAGE,
  verifyDeviceSignature,
  type DeviceSigningPayload,
  type JWKInterface,
  type LedgerTransport,
} from "@gleam/core";
import { signerFromJwk } from "@gleam/core/signer";
import { buildUnsignedDataItem, dataItemSignatureData } from "@gleam/core/src/arweave/data-item.ts";
import { signRsaPss } from "@gleam/core/src/arweave/rsa-pss.ts";
import { buildUnsignedTransaction, transactionSignatureData } from "@gleam/core/src/arweave/transaction.ts";
import type { DeviceSignPanelProps } from "./device-panels";
import { createLedgerPanel, WRONG_LEDGER_MESSAGE } from "./LedgerPanel";

afterEach(cleanup);

const GATEWAY = "https://arweave.net";
const TARGET = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

let deviceKey: JWKInterface;
let otherKey: JWKInterface;
let walletAddress: string;

beforeAll(async () => {
  [deviceKey, otherKey] = await Promise.all([generateJWK(), generateJWK()]);
  walletAddress = await addressFromOwner(deviceKey.n);
}, 60_000);

const ok = (data: Iterable<number> = []) => Uint8Array.from([...data, 0x90, 0x00]);
const sw = (word: number) => Uint8Array.from([word >> 8, word & 0xff]);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const VERSION_OK = ok([0, 1, 2, 3, 0]);

/**
 * Answers the Arweave app's APDUs with a WebCrypto key. On each SIGN or
 * SIGN_DATA_ITEM it reports the deep hash of the next payload the test
 * expects, so a payload signed out of order fails the client's hash check.
 */
class FakeLedger implements LedgerTransport {
  app = "Arweave";
  versions: Uint8Array[] = [VERSION_OK];
  /** Status word the device answers the final signing chunk with instead of the deep hash. */
  signRefusal: number | null = null;
  /** While set, the final signing chunk waits on it, as the device waits for the user. */
  hold: Promise<void> | null = null;
  readonly signIns: number[] = [];
  readonly close = vi.fn(async () => {});
  private versionCalls = 0;
  private signature = new Uint8Array();

  constructor(
    private readonly key: JWKInterface,
    private readonly hashes: Uint8Array<ArrayBuffer>[],
  ) {}

  async exchange(apdu: Uint8Array): Promise<Uint8Array> {
    if (apdu[0] === 0xb0) return ok([1, this.app.length, ...ascii(this.app), 5, ...ascii("1.2.3")]);
    const [, ins, p1, p2] = apdu;
    const modulus = base64UrlToBytes(this.key.n);
    switch (ins) {
      case 0x00:
        return this.versions[Math.min(this.versionCalls++, this.versions.length - 1)]!;
      case 0x01:
        return ok(ascii(await addressFromOwner(this.key.n)));
      case 0x20:
        return ok(p2 === 0 ? modulus.subarray(0, 256) : modulus.subarray(256));
      case 0x02:
      case 0x03: {
        if (p1 !== 2) return ok();
        this.signIns.push(ins);
        if (this.hold) await this.hold;
        if (this.signRefusal !== null) return sw(this.signRefusal);
        const hash = this.hashes.shift();
        if (!hash) return sw(0x6984);
        this.signature = await signRsaPss(signerFromJwk(this.key, ""), hash);
        return ok(hash);
      }
      case 0x10:
        return ok(p2 === 0 ? this.signature.subarray(0, 256) : this.signature.subarray(256));
      default:
        return sw(0x6d00);
    }
  }
}

async function transaction(quantity: string, tagCount = 1): Promise<DeviceSigningPayload> {
  const tags = Array.from({ length: tagCount }, (_, i) => ({ name: `Tag-${i}`, value: "x" }));
  const tx = await buildUnsignedTransaction(GATEWAY, deviceKey.n, { target: TARGET, quantity, reward: "1", last_tx: "b".repeat(64) }, tags);
  return { kind: "transaction", transaction: tx };
}

function dataItem(text: string): DeviceSigningPayload {
  const raw = buildUnsignedDataItem(deviceKey.n, {
    data: new TextEncoder().encode(text),
    tags: [{ name: "Action", value: "Transfer" }],
  });
  return { kind: "dataItem", raw: bytesToBase64Url(raw) };
}

function hashOf(payload: DeviceSigningPayload): Promise<Uint8Array<ArrayBuffer>> {
  if (payload.kind === "message") throw new Error("Not a deep-hash payload.");
  return payload.kind === "transaction"
    ? transactionSignatureData(payload.transaction)
    : dataItemSignatureData(base64UrlToBytes(payload.raw));
}

function unsigned(payload: DeviceSigningPayload) {
  if (payload.kind === "message") throw new Error("Not a deep-hash payload.");
  return payload.kind === "transaction" ? payload : { kind: "dataItem" as const, raw: base64UrlToBytes(payload.raw) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function setup(payloads: DeviceSigningPayload[], { key = deviceKey, activityMs = 10_000 } = {}) {
  const device = new FakeLedger(key, await Promise.all(payloads.map(hashOf)));
  const Panel = createLedgerPanel({
    openTransport: async () => device,
    pollMs: 5,
    appTimeoutMs: 200,
    keyTimeoutMs: 1_000,
    activityMs,
  });
  const props = {
    payloads,
    wallet: { method: "ledger" as const, device: { kind: "ledger" as const }, address: walletAddress, publicKey: deviceKey.n },
    onSignatures: vi.fn<(signatures: string[]) => void>(),
    onActivity: vi.fn(),
    onError: vi.fn<(message: string) => void>(),
    onCancel: vi.fn(),
  } satisfies DeviceSignPanelProps;
  const view = () => render(<Panel {...props} />);
  return { device, props, view };
}

const start = () => fireEvent.click(screen.getByRole("button", { name: "Sign on Ledger" }));

describe("LedgerPanel", () => {
  it("touches the device only after the click, then signs a transaction and closes the transport", async () => {
    const payload = await transaction("10");
    const { device, props, view } = await setup([payload]);
    const gate = deferred();
    device.hold = gate.promise;
    view();
    expect(device.signIns).toEqual([]);

    start();
    expect(await screen.findByText("Confirm on your Ledger. Check that it shows the details above.")).toBeTruthy();
    expect(screen.queryByText(/Item 1 of/)).toBeNull();
    gate.resolve();

    await waitFor(() => expect(props.onSignatures).toHaveBeenCalledTimes(1));
    const [signature] = props.onSignatures.mock.calls[0]![0];
    expect(await verifyDeviceSignature(unsigned(payload), base64UrlToBytes(signature!), deviceKey.n)).toBe(true);
    expect(device.close).toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("signs a batch in order and shows which item the device is on", async () => {
    const payloads = await Promise.all(["1", "2", "3"].map((quantity) => transaction(quantity)));
    const { device, props, view } = await setup(payloads);
    view();
    let gate = deferred();
    device.hold = gate.promise;
    start();
    expect(await screen.findByText("Item 1 of 3")).toBeTruthy();
    const first = gate;
    gate = deferred();
    device.hold = gate.promise;
    first.resolve();
    expect(await screen.findByText("Item 2 of 3")).toBeTruthy();
    device.hold = null;
    gate.resolve();

    await waitFor(() => expect(props.onSignatures).toHaveBeenCalledTimes(1));
    const signatures = props.onSignatures.mock.calls[0]![0];
    expect(signatures).toHaveLength(3);
    for (const [index, payload] of payloads.entries()) {
      expect(await verifyDeviceSignature(unsigned(payload), base64UrlToBytes(signatures[index]!), deviceKey.n)).toBe(true);
    }
    expect(device.signIns).toEqual([0x02, 0x02, 0x02]);
  });

  it("signs a data item on the Permaweb app", async () => {
    const payload = dataItem("hello AO");
    const { device, props, view } = await setup([payload]);
    device.app = "Permaweb";
    view();
    start();

    await waitFor(() => expect(props.onSignatures).toHaveBeenCalledTimes(1));
    const [signature] = props.onSignatures.mock.calls[0]![0];
    expect(await verifyDeviceSignature(unsigned(payload), base64UrlToBytes(signature!), deviceKey.n)).toBe(true);
    expect(device.signIns).toEqual([0x03]);
  });

  it("refuses a data item on the stock Arweave app before sending it to the device", async () => {
    const { device, props, view } = await setup([dataItem("hello AO")]);
    view();
    start();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(LEDGER_PERMAWEB_REQUIRED_MESSAGE));
    expect(LEDGER_PERMAWEB_REQUIRED_MESSAGE).toBe(
      "Ledger only supports sending AR for now. To send AO tokens or sign data items, use a Keystone.",
    );
    expect(device.signIns).toEqual([]);
    expect(device.close).toHaveBeenCalled();
    expect(props.onSignatures).not.toHaveBeenCalled();
  });

  it("refuses a Ledger whose address isn't this wallet's", async () => {
    const { device, props, view } = await setup([await transaction("1")], { key: otherKey });
    view();
    start();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(WRONG_LEDGER_MESSAGE));
    expect(device.signIns).toEqual([]);
    expect(device.close).toHaveBeenCalled();
  });

  it("waits while the app generates its key, then signs", async () => {
    const { device, props, view } = await setup([await transaction("1")]);
    device.versions = [sw(0x6e00), sw(0x6987), sw(0x6987), sw(0x6987), VERSION_OK];
    const gate = deferred();
    device.hold = gate.promise;
    view();
    start();

    expect(await screen.findByText(/Your Ledger is generating its Arweave key/)).toBeTruthy();
    gate.resolve();
    await waitFor(() => expect(props.onSignatures).toHaveBeenCalledTimes(1));
  });

  it("reports a rejection on the device and closes the transport", async () => {
    const { device, props, view } = await setup([await transaction("1")]);
    device.signRefusal = 0x6986;
    view();
    start();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Request rejected on your Ledger."));
    expect(device.close).toHaveBeenCalled();
    expect(props.onSignatures).not.toHaveBeenCalled();
  });

  it("shows the client's own refusal, such as too many tags", async () => {
    const { device, props, view } = await setup([await transaction("1", 17)]);
    view();
    start();

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Ledger signs at most 16 tags."));
    expect(device.signIns).toEqual([]);
  });

  it("keeps the request alive while the device waits on the user", async () => {
    const { device, props, view } = await setup([await transaction("1")], { activityMs: 10 });
    const gate = deferred();
    device.hold = gate.promise;
    view();
    start();

    await waitFor(() => expect(props.onActivity.mock.calls.length).toBeGreaterThanOrEqual(2));
    gate.resolve();
    await waitFor(() => expect(props.onSignatures).toHaveBeenCalledTimes(1));
  });

  it("closes the transport on unmount and reports nothing", async () => {
    const { device, props, view } = await setup([await transaction("1")]);
    device.hold = new Promise(() => {});
    const { unmount } = view();
    start();
    await waitFor(() => expect(device.signIns).toHaveLength(1));

    unmount();
    await waitFor(() => expect(device.close).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(props.onError).not.toHaveBeenCalled();
    expect(props.onSignatures).not.toHaveBeenCalled();
  });
});
