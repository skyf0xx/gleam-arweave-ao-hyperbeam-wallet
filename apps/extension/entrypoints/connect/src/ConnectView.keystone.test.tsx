import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArweaveCryptoAccount } from "@keystonehq/bc-ur-registry-arweave";
import type { RuntimePort } from "@gleam/core";
import type { QrScannerProps } from "@gleam/keystone";
import { ConnectView } from "./ConnectView";

afterEach(cleanup);

const modulus = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 5 + 1) % 256));
const accountUr = new ArweaveCryptoAccount(Buffer.from("0a1b2c3d", "hex"), modulus, "Keystone").toUR();

function FakeScanner(props: QrScannerProps) {
  return <button onClick={() => props.onComplete(accountUr)}>fake-scan</button>;
}

async function connectWith(send: RuntimePort["send"], onClose = vi.fn()) {
  render(<ConnectView runtime={{ send, onMessage: vi.fn(() => () => {}) }} Scanner={FakeScanner} onClose={onClose} />);
  fireEvent.click(screen.getByText("fake-scan"));
  fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
}

describe("ConnectView", () => {
  it("says the tab can close once the Keystone is connected", async () => {
    const onClose = vi.fn();
    await connectWith(vi.fn().mockResolvedValue({ id: "w1" }) as never, onClose);
    await screen.findByText("Keystone connected. You can close this tab.");
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("tells the user to unlock Gleam when the background refuses", async () => {
    await connectWith(vi.fn().mockRejectedValue(new Error("Unlock Gleam before adding a hardware wallet.")) as never);
    expect((await screen.findByRole("alert")).textContent).toMatch(/unlock it/);
  });
});
