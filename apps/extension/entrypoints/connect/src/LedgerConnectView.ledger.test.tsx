import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bytesToBase64Url, type RuntimePort } from "@gleam/core";
import { LedgerTransportError } from "@/src/hardware/ledger";
import { LedgerConnectView } from "./LedgerConnectView";

afterEach(cleanup);

const modulus = Uint8Array.from({ length: 512 }, (_, i) => (i * 7 + 3) % 256);
const owner = bytesToBase64Url(modulus);
let address = "";

async function sha256Address(): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", modulus)));
}

const ok = (...data: number[]) => Uint8Array.from([...data, 0x90, 0x00]);
const sw = (code: number) => Uint8Array.from([code >> 8, code & 0xff]);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

interface Script {
  /** Replies to successive GET_VERSION calls; the last repeats. */
  versions: Uint8Array[];
  appName?: string;
  /** Replaces the reply to GET_ADDRESS with verify set. */
  verifyReply?: Promise<Uint8Array> | Uint8Array;
}

const VERSION_OK = ok(0, 1, 2, 3, 0);

function fakeTransport(script: Script) {
  let versionCalls = 0;
  const close = vi.fn(async () => {});
  const exchange = vi.fn(async (apdu: Uint8Array): Promise<Uint8Array> => {
    if (apdu[0] === 0xb0) {
      const name = script.appName ?? "Arweave";
      return ok(1, name.length, ...ascii(name), 5, ...ascii("1.2.3"));
    }
    const [, ins, p1, p2] = apdu;
    if (ins === 0x00) {
      const reply = script.versions[Math.min(versionCalls, script.versions.length - 1)]!;
      versionCalls += 1;
      return reply;
    }
    if (ins === 0x01) return p1 === 1 && script.verifyReply ? script.verifyReply : ok(...ascii(address));
    if (ins === 0x20) return p2 === 0 ? ok(...modulus.subarray(0, 256)) : ok(...modulus.subarray(256));
    return sw(0x6d00);
  });
  const transport = { exchange, close, model: "Nano S Plus" };
  return { transport, close, exchange };
}

function runtimeOf(send: RuntimePort["send"]): RuntimePort {
  return { send, onMessage: vi.fn(() => () => {}) };
}

const fast = { pollMs: 5, appTimeoutMs: 80, keyTimeoutMs: 400, autoCloseMs: 10_000 };

async function renderView(script: Script, send: RuntimePort["send"] = vi.fn() as never, props = {}) {
  address = await sha256Address();
  const fake = fakeTransport(script);
  render(
    <LedgerConnectView
      runtime={runtimeOf(send)}
      openTransport={async () => fake.transport}
      onClose={vi.fn()}
      {...fast}
      {...props}
    />,
  );
  return fake;
}

const connectButton = () => screen.getByRole("button", { name: "Connect" });

describe("LedgerConnectView", () => {
  it("shows instructions, polls until the app opens, verifies, then adds the wallet", async () => {
    const send = vi.fn().mockResolvedValue({ id: "w1" });
    const fake = await renderView({ versions: [sw(0x6e00), sw(0x6e00), VERSION_OK] }, send as never);
    expect(screen.getByText(/Open the Arweave app/)).toBeTruthy();

    fireEvent.click(connectButton());
    await screen.findByText(/Waiting for the Arweave app/);
    await screen.findByLabelText("Name");
    expect(fake.close).toHaveBeenCalled();

    fireEvent.click(connectButton());
    await screen.findByText("Ledger connected. You can close this tab.");
    expect(send).toHaveBeenCalledWith({
      type: "addHardwareWallet",
      payload: {
        method: "ledger",
        publicKey: owner,
        device: { kind: "ledger", model: "Nano S Plus", appVersion: "1.2.3", app: "Arweave" },
      },
    });
  });

  it("records the Permaweb app and a typed name", async () => {
    const send = vi.fn().mockResolvedValue({ id: "w1" });
    await renderView({ versions: [VERSION_OK], appName: "Permaweb" }, send as never);
    fireEvent.click(connectButton());
    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Vault " } });
    fireEvent.click(connectButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    const payload = send.mock.calls[0]![0].payload;
    expect(payload.name).toBe("Vault");
    expect(payload.device.app).toBe("Permaweb");
  });

  it("shows key-generating progress and keeps polling past the app timeout", async () => {
    await renderView({ versions: [sw(0x6987), sw(0x6987), sw(0x6987), VERSION_OK] }, vi.fn() as never, {
      pollMs: 40,
    });
    fireEvent.click(connectButton());
    await screen.findByText(/generating its Arweave key/);
    await screen.findByLabelText("Name", {}, { timeout: 2000 });
  });

  it("gives up on a missing app after the timeout", async () => {
    await renderView({ versions: [sw(0x6e00)] });
    fireEvent.click(connectButton());
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't find the Arweave app/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("cancels while waiting and returns to the start", async () => {
    const fake = await renderView({ versions: [sw(0x6e00)] }, vi.fn() as never, { appTimeoutMs: 60_000 });
    fireEvent.click(connectButton());
    await screen.findByText(/Waiting for the Arweave app/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText(/Plug in your Ledger and unlock it/);
    expect(fake.close).toHaveBeenCalled();
  });

  it("shows the full address while the device waits for approval", async () => {
    let approve!: (reply: Uint8Array) => void;
    await renderView({ versions: [VERSION_OK], verifyReply: new Promise((r) => (approve = r)) });
    fireEvent.click(connectButton());
    await screen.findByText("Check the address on your Ledger matches:");
    expect(screen.getByText(address)).toBeTruthy();
    approve(ok(...ascii(address)));
    await screen.findByLabelText("Name");
  });

  it("shows the rejection when the address is declined on the device", async () => {
    await renderView({ versions: [VERSION_OK], verifyReply: sw(0x6986) });
    fireEvent.click(connectButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Request rejected on your Ledger.");
  });

  it("explains a busy device", async () => {
    address = await sha256Address();
    render(
      <LedgerConnectView
        runtime={runtimeOf(vi.fn() as never)}
        openTransport={async () => {
          throw new LedgerTransportError("busy");
        }}
        onClose={vi.fn()}
        {...fast}
      />,
    );
    fireEvent.click(connectButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Close Ledger Live or other wallet windows and try again.",
    );
  });

  it("words the duplicate-address refusal for a Ledger", async () => {
    const send = vi.fn().mockRejectedValue(new Error('This address is already in Gleam as "Ledger 1".'));
    await renderView({ versions: [VERSION_OK] }, send as never);
    fireEvent.click(connectButton());
    await screen.findByLabelText("Name");
    fireEvent.click(connectButton());
    expect((await screen.findByRole("alert")).textContent).toBe('This Ledger is already in Gleam as "Ledger 1".');
  });

  it("tells the user to unlock Gleam when the background refuses", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Unlock Gleam before adding a hardware wallet."));
    await renderView({ versions: [VERSION_OK] }, send as never);
    fireEvent.click(connectButton());
    await screen.findByLabelText("Name");
    fireEvent.click(connectButton());
    expect((await screen.findByRole("alert")).textContent).toMatch(/unlock it/);
  });
});
