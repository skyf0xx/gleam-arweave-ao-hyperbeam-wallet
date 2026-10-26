import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArweaveCryptoAccount } from "@keystonehq/bc-ur-registry-arweave";
import type { RuntimePort } from "@gleam/core";
import type { QrScannerProps } from "./QrScanner";
import { KeystoneConnectView, type KeystoneConnectViewProps } from "./KeystoneConnectView";

afterEach(cleanup);

const modulus = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 5 + 1) % 256));
const accountUr = new ArweaveCryptoAccount(Buffer.from("0a1b2c3d", "hex"), modulus, "Keystone").toUR();

/** A scanner that reports whatever the test hands it, once mounted. */
function scannerOf(emit: (props: QrScannerProps) => void) {
  return function FakeScanner(props: QrScannerProps) {
    return <button onClick={() => emit(props)}>fake-scan</button>;
  };
}

function runtimeOf(send: RuntimePort["send"]): RuntimePort {
  return { send, onMessage: vi.fn(() => () => {}) };
}

function renderView(props: Partial<KeystoneConnectViewProps> & Pick<KeystoneConnectViewProps, "runtime">) {
  render(
    <KeystoneConnectView
      onConnected={vi.fn()}
      cameraDeniedHelp="Turn the camera on for Gleam."
      Scanner={scannerOf((p) => p.onComplete(accountUr))}
      {...props}
    />,
  );
}

async function scanToConfirm(send: RuntimePort["send"], props: Partial<KeystoneConnectViewProps> = {}) {
  renderView({ runtime: runtimeOf(send), ...props });
  fireEvent.click(screen.getByText("fake-scan"));
  await screen.findByRole("button", { name: "Connect" });
}

describe("KeystoneConnectView", () => {
  it("shows the truncated address, sends addHardwareWallet with the default name left to the background, and reports the wallet", async () => {
    const send = vi.fn().mockResolvedValue({ id: "w1" });
    const onConnected = vi.fn();
    await scanToConfirm(send as never, { onConnected });
    expect(screen.getByText(/^[\w-]{5}…[\w-]{4}$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith({ id: "w1" }));
    expect(send).toHaveBeenCalledWith({
      type: "addHardwareWallet",
      payload: {
        method: "keystone",
        publicKey: modulus.toString("base64url"),
        device: { kind: "keystone", xfp: "0a1b2c3d" },
      },
    });
  });

  it("sends a typed name", async () => {
    const send = vi.fn().mockResolvedValue({ id: "w1" });
    await scanToConfirm(send as never);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Desk " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![0].payload.name).toBe("Desk");
  });

  it("shows the background's refusal, through the shell's rewrite when it has one", async () => {
    const send = vi.fn().mockRejectedValue(new Error('This address is already in Gleam as "Keystone 1".'));
    await scanToConfirm(send as never);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already in Gleam");
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    cleanup();

    await scanToConfirm(send as never, { errorText: () => "Rewritten." });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Rewritten.");
  });

  it.each([
    ["camera-denied", /Turn the camera on for Gleam/],
    ["wrong-type", /not a Keystone Arweave account QR/],
  ] as const)("explains a %s scan error and can retry", async (error, text) => {
    renderView({ runtime: runtimeOf(vi.fn()), Scanner: scannerOf((p) => p.onError(error)) });
    fireEvent.click(screen.getByText("fake-scan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("fake-scan")).toBeTruthy();
  });
});
