import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityPage, FeeEstimate, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { SendView, type SendViewProps } from "./SendView";

afterEach(() => {
  cleanup();
});

/**
 * `SendView` now reads shared balances via `useBalances` (TanStack Query),
 * which requires a `QueryClientProvider` ancestor — mirrors `App.tsx`'s
 * real wiring. A fresh `QueryClient` per render keeps each test's cache
 * isolated from the others.
 */
function renderSendView(props: SendViewProps) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SendView {...props} />
    </QueryClientProvider>,
  );
}

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
};

const AO_TOKEN: TokenBalance = {
  address: WALLET.address,
  processId: "process-ao-token-1",
  ticker: "ARDRIVE",
  denomination: 6,
  quantity: "5000000",
};

const RECENT_RECIPIENT_A = "AAAAAA1111111111111111111111111111111111111";
const RECENT_RECIPIENT_B = "BBBBBB2222222222222222222222222222222222222";

function activityPage(entries: ActivityPage["entries"]): ActivityPage {
  return { entries, cursor: null };
}

/** Routes a fake `runtime.send` by message `type`, matching each test's needs. */
function routedSend(handlers: {
  getBalance?: (payload: { address: string }) => string;
  getTokenBalances?: (payload: { address: string }) => TokenBalance[];
  getActivity?: (payload: { address: string }) => ActivityPage;
  estimateTransfer?: () => FeeEstimate;
  submitTransfer?: () => { txId: string };
}) {
  return vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "getBalance":
        return handlers.getBalance?.(message.payload as { address: string }) ?? "1000000000000";
      case "getTokenBalances":
        return handlers.getTokenBalances?.(message.payload as { address: string }) ?? [];
      case "getActivity":
        return handlers.getActivity?.(message.payload as { address: string }) ?? activityPage([]);
      case "estimateTransfer":
        return (
          handlers.estimateTransfer?.() ?? {
            fee: "100000000",
            firstSeenRecipient: false,
          }
        );
      case "submitTransfer":
        return handlers.submitTransfer?.() ?? { txId: "tx-123" };
      default:
        throw new Error(`unhandled message type in test: ${message.type}`);
    }
  });
}

describe("SendView token picker (AO-SEND-UI-WALLET-CORE)", () => {
  it("opening the picker lists AR plus every getTokenBalances token, all selectable", async () => {
    const send = routedSend({ getTokenBalances: () => [AO_TOKEN] });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /^AR/ }));

    await waitFor(() => expect(screen.getByText("Arweave")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText("ARDRIVE").length).toBeGreaterThan(0));
    expect(send).toHaveBeenCalledWith({ type: "getTokenBalances", payload: { address: WALLET.address } });

    // Both rows are real buttons (genuinely clickable, no disabled state).
    const arweaveButton = screen.getByText("Arweave").closest("button");
    const ardriveButton = screen.getByRole("button", { name: /ARDRIVE/ });
    expect(arweaveButton).not.toBeNull();
    expect(arweaveButton?.disabled).toBeFalsy();
    expect(ardriveButton.getAttribute("disabled")).toBeNull();
  });

  it("selecting a non-AR token sets the compose ticker and carries it through estimate/submit", async () => {
    const send = routedSend({
      getTokenBalances: () => [AO_TOKEN],
      estimateTransfer: () => ({ fee: null, firstSeenRecipient: false }),
      submitTransfer: () => ({ txId: "ao-tx-456" }),
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /^AR/ }));
    await waitFor(() => expect(screen.getAllByText("ARDRIVE").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /ARDRIVE/ }));

    // Back on compose, now showing the AO token's ticker.
    await waitFor(() => expect(screen.getByText("Send ARDRIVE")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Paste an address"), {
      target: { value: RECENT_RECIPIENT_A },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "estimateTransfer",
        payload: {
          walletId: WALLET.id,
          recipient: RECENT_RECIPIENT_A,
          token: AO_TOKEN.processId,
          amount: "2500000",
          fee: null,
        },
      }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign and send" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Sign and send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "submitTransfer",
        payload: {
          walletId: WALLET.id,
          recipient: RECENT_RECIPIENT_A,
          token: AO_TOKEN.processId,
          amount: "2500000",
          fee: null,
        },
      }),
    );

    await waitFor(() => expect(screen.getByText("Signed and sent.")).toBeTruthy());
    expect(screen.getByText(`2.5 ARDRIVE to ${RECENT_RECIPIENT_A}`)).toBeTruthy();
  });
});

describe("SendView recent recipients (AO-SEND-UI-WALLET-CORE)", () => {
  it("populates from real send activity, most-recent-first and deduplicated", async () => {
    const send = routedSend({
      getActivity: () =>
        activityPage([
          { txId: "tx-1", type: "send", status: "confirmed", address: RECENT_RECIPIENT_A, amount: "1", tags: [], timestamp: 100 },
          { txId: "tx-2", type: "receive", status: "confirmed", address: "someone-else", amount: "1", tags: [], timestamp: 200 },
          { txId: "tx-3", type: "send", status: "confirmed", address: RECENT_RECIPIENT_B, amount: "1", tags: [], timestamp: 300 },
          { txId: "tx-4", type: "send", status: "confirmed", address: RECENT_RECIPIENT_A, amount: "1", tags: [], timestamp: 50 },
        ]),
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "getActivity", payload: { address: WALLET.address } }));

    const dialog = await screen.findByRole("dialog", { name: "Recent recipients" });
    const rows = within(dialog).getAllByRole("button");
    // Back button in ScreenHeader is a separate `aria-label="Back"` button;
    // the recipient rows are the remaining ones, most-recent-first, deduped.
    const recipientRows = rows.filter((row) => row.getAttribute("aria-label") !== "Back");
    expect(recipientRows).toHaveLength(2);
    expect(recipientRows[0].textContent).toContain(RECENT_RECIPIENT_B.slice(0, 6));
    expect(recipientRows[1].textContent).toContain(RECENT_RECIPIENT_A.slice(0, 6));
  });

  it("shows an appropriate empty state, not an error or placeholder address, when there is no prior send activity", async () => {
    const send = routedSend({ getActivity: () => activityPage([]) });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));

    await waitFor(() => expect(screen.getByText(/No recent recipients yet/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the error state (not an empty state) when getActivity itself fails", async () => {
    const failingSend = vi.fn(async (message: { type: string; payload: unknown }) => {
      if (message.type === "getActivity") throw new Error("unreachable");
      return routedSend({})(message);
    });
    renderSendView({ runtime: fakeRuntime({ send: failingSend }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/No recent recipients yet/)).toBeNull();
  });

  it("selecting a recent recipient fills the recipient field with the full address", async () => {
    const send = routedSend({
      getActivity: () =>
        activityPage([
          { txId: "tx-1", type: "send", status: "confirmed", address: RECENT_RECIPIENT_A, amount: "1", tags: [], timestamp: 100 },
        ]),
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    await waitFor(() => expect(screen.getByText(new RegExp(RECENT_RECIPIENT_A.slice(0, 6)))).toBeTruthy());
    fireEvent.click(screen.getByText(new RegExp(RECENT_RECIPIENT_A.slice(0, 6))));

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText("Paste an address") as HTMLTextAreaElement;
      expect(textarea.value).toBe(RECENT_RECIPIENT_A);
    });
  });

  it("shows the full, untruncated recipient address on the review screen regardless of selection method", async () => {
    const send = routedSend({
      getActivity: () =>
        activityPage([
          { txId: "tx-1", type: "send", status: "confirmed", address: RECENT_RECIPIENT_A, amount: "1", tags: [], timestamp: 100 },
        ]),
      estimateTransfer: () => ({ fee: "100000000", firstSeenRecipient: false }),
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    await waitFor(() => expect(screen.getByText(new RegExp(RECENT_RECIPIENT_A.slice(0, 6)))).toBeTruthy());
    fireEvent.click(screen.getByText(new RegExp(RECENT_RECIPIENT_A.slice(0, 6))));

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText("Paste an address") as HTMLTextAreaElement;
      expect(textarea.value).toBe(RECENT_RECIPIENT_A);
    });

    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Review send")).toBeTruthy());
    expect(screen.getByText(RECENT_RECIPIENT_A)).toBeTruthy();
  });
});
