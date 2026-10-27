import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { PlatformProvider } from "../../../app-platform/context";
import { QrScanError } from "../../../app-platform/qr-scanner";
import { fakeAppPlatform, type FakeAppPlatformOverrides } from "../../../app-platform/testing";
import { SendView } from "./SendView";

afterEach(cleanup);

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};
const ADDRESS = "AAAAAA1111111111111111111111111111111111111";

function renderSend(overrides: FakeAppPlatformOverrides) {
  const send = vi.fn(async (message: { type: string }) => {
    switch (message.type) {
      case "getBalance":
        return "1000000000000";
      case "getArFee":
        return "100000000";
      case "getState":
        return { wallets: [WALLET], activeWalletId: WALLET.id, session: null };
      case "getActivity":
        return { entries: [], cursor: null };
      case "getTokenBalances":
      case "listContacts":
      case "getTokenPrices":
        return [];
      case "getDisplaySettings":
        return { currency: "USD", showChart: true, showTokenLogos: false, headline: "total", balancesHidden: false };
      default:
        return undefined;
    }
  });
  const runtime: RuntimePort = { send: send as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <PlatformProvider platform={fakeAppPlatform({ runtime, ...overrides })}>
      <QueryClientProvider client={queryClient}>
        <SendView runtime={runtime} wallet={WALLET} token={null} onBack={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>
    </PlatformProvider>,
  );
}

describe("SendView QR scan", () => {
  it("shows no scan button where the shell can't scan", () => {
    renderSend({ capabilities: { qrScanner: false } });
    expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
  });

  it("puts a scanned address through the same checks as typing", async () => {
    renderSend({ capabilities: { qrScanner: true }, qrScanner: { scan: async () => ` ${ADDRESS}\n` } });
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    // A valid address swaps the input for its card.
    await waitFor(() => expect(screen.queryByLabelText("Recipient address")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops a known scheme and nothing else", async () => {
    renderSend({ capabilities: { qrScanner: true }, qrScanner: { scan: async () => `ar://${ADDRESS}` } });
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    await waitFor(() => expect(screen.queryByLabelText("Recipient address")).toBeNull());
  });

  it("shows the typed-input error for an invalid scan, params included", async () => {
    renderSend({ capabilities: { qrScanner: true }, qrScanner: { scan: async () => `arweave:${ADDRESS}?amount=5` } });
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    const input = await screen.findByLabelText("Recipient address");
    expect((input as HTMLInputElement).value).toBe(`${ADDRESS}?amount=5`);
    expect((await screen.findByRole("alert")).textContent).toContain("doesn't look like a full Arweave address");
  });

  it("leaves the field alone when the user cancels", async () => {
    const scan = vi.fn(async () => null);
    renderSend({ capabilities: { qrScanner: true }, qrScanner: { scan } });
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    await waitFor(() => expect(scan).toHaveBeenCalled());
    expect((screen.getByLabelText("Recipient address") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a denied camera", async () => {
    renderSend({
      capabilities: { qrScanner: true },
      qrScanner: {
        scan: async () => {
          throw new QrScanError("permission-denied", "denied");
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Camera access is off");
  });
});
