import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArweaveCryptoAccount } from "@keystonehq/bc-ur-registry-arweave";
import type { RuntimePort } from "@gleam/core";
import type { QrScannerProps } from "@/src/hardware/keystone";
import { ConnectView } from "./ConnectView";

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

async function scanToConfirm(send: RuntimePort["send"]) {
  render(
    <ConnectView
      runtime={runtimeOf(send)}
      Scanner={scannerOf((p) => p.onComplete(accountUr))}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("fake-scan"));
  await screen.findByRole("button", { name: "Connect" });
}

describe("ConnectView", () => {
  it("shows the truncated address and sends addHardwareWallet with the default name left to the background", async () => {
    const send = vi.fn().mockResolvedValue({ id: "w1" });
    await scanToConfirm(send as never);
    expect(screen.getByText(/^[\w-]{5}…[\w-]{4}$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Keystone connected. You can close this tab.");
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

  it("tells the user to unlock Gleam when the background refuses", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Unlock Gleam before adding a hardware wallet."));
    await scanToConfirm(send as never);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/unlock it/);
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("shows the background's duplicate-address message", async () => {
    const send = vi.fn().mockRejectedValue(new Error('This address is already in Gleam as "Keystone 1".'));
    await scanToConfirm(send as never);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already in Gleam");
  });

  it.each([
    ["camera-denied", /set Camera to Allow/],
    ["wrong-type", /not a Keystone Arweave account QR/],
  ] as const)("explains a %s scan error and can retry", async (error, text) => {
    render(
      <ConnectView
        runtime={runtimeOf(vi.fn())}
        Scanner={scannerOf((p) => p.onError(error))}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("fake-scan"));
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("fake-scan")).toBeTruthy();
  });
});
