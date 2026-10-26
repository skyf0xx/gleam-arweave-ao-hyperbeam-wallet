import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Collectible, FeeEstimate, RuntimePort, WalletSummary } from "@gleam/core";
import { addressText } from "@gleam/ui/src/components/wallet/MemorableAddress.testing.ts";
import { walletQueryKeys } from "../../activity/src/queryKeys";
import { PlatformProvider } from "../../../app-platform/context";
import { fakeAppPlatform } from "../../../app-platform/testing";
import { SendCollectibleView } from "./SendCollectibleView";

afterEach(cleanup);

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "WaLLeT_AdDrEsS-0123456789abcdefghijklmnopqr",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";

const COLLECTIBLE: Collectible = {
  id: "aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs",
  name: "Beam #1",
  ticker: "ASSET",
  contentType: "image/png",
  imageUrl: "https://arweave.net/aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs",
};

function setup(
  handlers: { estimate?: () => FeeEstimate; send?: () => { txId: string } } = {},
  wallet: WalletSummary = WALLET,
) {
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "estimateCollectibleSend":
        return handlers.estimate?.() ?? { fee: "654321", firstSeenRecipient: false };
      case "sendCollectible":
        return handlers.send?.() ?? { txId: "tx-nft" };
      case "listContacts":
        return [];
      case "getState":
        return { wallets: [wallet], activeWalletId: wallet.id, session: null };
      case "getActivity":
        return { entries: [], cursor: null };
      default:
        return undefined;
    }
  });
  const runtime: RuntimePort = { send: send as RuntimePort["send"], onMessage: vi.fn(() => () => {}) };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(walletQueryKeys.collectibles(wallet.address), [COLLECTIBLE]);
  const onDone = vi.fn();
  render(
    <PlatformProvider platform={fakeAppPlatform()}>
      <QueryClientProvider client={queryClient}>
        <SendCollectibleView runtime={runtime} wallet={wallet} collectible={COLLECTIBLE} onBack={vi.fn()} onDone={onDone} />
      </QueryClientProvider>
    </PlatformProvider>,
  );
  return { send, queryClient, onDone };
}

function enterRecipient(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Paste an address"), { target: { value } });
}

describe("SendCollectibleView", () => {
  it("has no amount field", () => {
    setup();
    expect(screen.queryByPlaceholderText("0")).toBeNull();
    expect(screen.queryByText(/Max/)).toBeNull();
    expect(screen.getByText("Beam #1")).toBeTruthy();
  });

  it("goes compose → review → success and drops the sent collectible from the list", async () => {
    const { send, queryClient, onDone } = setup();

    enterRecipient(RECIPIENT);
    fireEvent.click(screen.getByRole("button", { name: "Review and Send" }));

    await screen.findByText("Review send");
    expect(send).toHaveBeenCalledWith({
      type: "estimateCollectibleSend",
      payload: {
        walletId: WALLET.id,
        recipient: RECIPIENT,
        collectible: { id: COLLECTIBLE.id, name: COLLECTIBLE.name, imageUrl: COLLECTIBLE.imageUrl },
      },
    });
    expect(screen.getByText(addressText(RECIPIENT))).toBeTruthy();
    expect(screen.getByText("0.000000654321 AR")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Beam #1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send collectible" }));

    await screen.findByText("Signed and sent.");
    expect(send).toHaveBeenCalledWith({
      type: "sendCollectible",
      payload: {
        walletId: WALLET.id,
        recipient: RECIPIENT,
        collectible: { id: COLLECTIBLE.id, name: COLLECTIBLE.name, imageUrl: COLLECTIBLE.imageUrl },
      },
    });
    expect(screen.getByText(`Beam #1 to ${RECIPIENT}`)).toBeTruthy();
    expect(queryClient.getQueryData(walletQueryKeys.collectibles(WALLET.address))).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("refuses to send to the wallet's own address", async () => {
    const { send } = setup();

    enterRecipient(WALLET.address);
    fireEvent.click(screen.getByRole("button", { name: "Review and Send" }));

    expect(await screen.findByText(/this wallet's own address/)).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "estimateCollectibleSend" }));
  });

  it("refuses to send to the collectible's own process id", async () => {
    const { send } = setup();

    enterRecipient(COLLECTIBLE.id);
    fireEvent.click(screen.getByRole("button", { name: "Review and Send" }));

    expect(await screen.findByText("That's the collectible's own address. Enter the recipient's wallet address.")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "estimateCollectibleSend" }));
  });

  it("shows the fee error when the wallet's AR can't cover it", async () => {
    setup({
      estimate: () => {
        throw new Error("Sending needs about 0.000000654321 AR for the network fee.");
      },
    });

    enterRecipient(RECIPIENT);
    fireEvent.click(screen.getByRole("button", { name: "Review and Send" }));

    expect(await screen.findByText("Sending needs about 0.000000654321 AR for the network fee.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send collectible" })).toBeNull();
  });

  it("keeps the review step and shows the error when the send fails", async () => {
    setup({
      send: () => {
        throw new Error("Gateway down");
      },
    });

    enterRecipient(RECIPIENT);
    fireEvent.click(screen.getByRole("button", { name: "Review and Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send collectible" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Gateway down"));
    expect(screen.getByText("Review send")).toBeTruthy();
  });
});
