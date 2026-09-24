import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityPage, FeeEstimate, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { SendView, type SendViewProps } from "./SendView";

afterEach(() => {
  cleanup();
});

/**
 * `SendView` now reads shared balances/activity via `useBalances`/
 * `useActivity` (TanStack Query), which requires a `QueryClientProvider`
 * ancestor — mirrors `App.tsx`'s real wiring. A fresh `QueryClient` per
 * render keeps each test's cache isolated from the others. `retry: false`
 * (unlike the app's own default-config client) so a mocked `runtime.send`
 * rejection surfaces as this query's error state on the first attempt
 * instead of TanStack's default 3-retry backoff dragging error-path tests
 * past `waitFor`'s timeout.
 */
function renderSendView(props: SendViewProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  backupConfirmedAt: null,
};

const AO_TOKEN: TokenBalance = {
  address: WALLET.address,
  processId: "process-ao-token-1",
  ticker: "ARDRIVE",
  denomination: 6,
  name: null,
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
  getArFee?: () => string;
  estimateTransfer?: () => FeeEstimate;
  submitTransfer?: () => { txId: string };
}): RuntimePort["send"] {
  return vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "getBalance":
        return handlers.getBalance?.(message.payload as { address: string }) ?? "1000000000000";
      case "getTokenBalances":
        return handlers.getTokenBalances?.(message.payload as { address: string }) ?? [];
      case "getActivity":
        return handlers.getActivity?.(message.payload as { address: string }) ?? activityPage([]);
      case "getArFee":
        return handlers.getArFee?.() ?? "100000000";
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
  }) as RuntimePort["send"];
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

  it("shows AR and a default AO row at '0', both selectable, while balances are still loading", async () => {
    const send = vi.fn(() => new Promise(() => {})) as unknown as RuntimePort["send"]; // never resolves -- stays in the loading state.
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /^AR/ }));

    const arweaveRow = (await screen.findByText("Arweave")).closest("button");
    expect(arweaveRow).not.toBeNull();
    expect(arweaveRow?.textContent).toContain("0");
    expect(arweaveRow?.disabled).toBeFalsy();

    const aoRow = screen.getAllByText("AO")[0]!.closest("button");
    expect(aoRow).not.toBeNull();
    expect(aoRow?.textContent).toContain("0");
    expect(aoRow?.getAttribute("disabled")).toBeNull();
  });

  it("always renders a default AO row above other watched AO tokens, even with no AO balance entry", async () => {
    const send = routedSend({ getTokenBalances: () => [AO_TOKEN] });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /^AR/ }));

    await waitFor(() => expect(screen.getAllByText("ARDRIVE").length).toBeGreaterThan(0));

    const dialog = screen.getByRole("dialog", { name: "Select token" });
    const rowNames = within(dialog)
      .getAllByRole("button")
      .filter((row) => row.getAttribute("aria-label") !== "Back")
      .map((row) => row.textContent ?? "");

    const arIndex = rowNames.findIndex((text) => text.includes("Arweave"));
    const aoIndex = rowNames.findIndex((text) => text.includes("AO") && !text.includes("ARDRIVE"));
    const ardriveIndex = rowNames.findIndex((text) => text.includes("ARDRIVE"));

    expect(arIndex).toBe(0);
    expect(aoIndex).toBe(1);
    expect(ardriveIndex).toBe(2);

    // No live AO balance was returned, so the default AO row still reads "0".
    expect(rowNames[aoIndex]).toContain("0");

    // The default AO row is genuinely selectable even without a real balance.
    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .filter((row) => row.getAttribute("aria-label") !== "Back")[1]!,
    );
    await waitFor(() => expect(screen.getByText(/^Send AO$/)).toBeTruthy());
  });

  it("updates the AR and AO default rows to real balances once they load, without disturbing other watched tokens", async () => {
    const AO_DEFAULT_TOKEN: TokenBalance = {
      address: WALLET.address,
      processId: "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc",
      ticker: "AO",
      denomination: 12,
      name: null,
      quantity: "3000000000000",
    };
    const send = routedSend({
      getBalance: () => "2000000000000",
      getTokenBalances: () => [AO_DEFAULT_TOKEN, AO_TOKEN],
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: /^AR/ }));

    const arweaveRow = await screen.findByText("Arweave");
    await waitFor(() => expect(arweaveRow.closest("button")?.textContent).toContain("2"));

    await waitFor(() => {
      const aoRow = screen.getAllByText("AO")[0]!.closest("button");
      expect(aoRow?.textContent).toContain("3");
    });

    expect(screen.getAllByText("ARDRIVE").length).toBeGreaterThan(0);
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

describe("SendView AR Max and balance check account for the network fee", () => {
  it("Max fills in balance minus the estimated fee, not the whole balance", async () => {
    const send = routedSend({
      getBalance: () => "1000000000000", // 1 AR
      getArFee: () => "50000000000", // 0.05 AR
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    const maxButton = await screen.findByRole("button", { name: /^Max:/ });
    expect(maxButton.textContent).toContain("0.95");

    fireEvent.click(maxButton);
    const amountInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    expect(amountInput.value).toBe("0.95");
  });

  it("hides Max until the fee estimate has resolved", async () => {
    const send = vi.fn((message: { type: string; payload: unknown }) => {
      if (message.type === "getArFee") return new Promise(() => {}); // never resolves
      return routedSend({})(message, undefined);
    }) as unknown as RuntimePort["send"];
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    await screen.findByPlaceholderText("0.00");
    expect(screen.queryByRole("button", { name: /^Max:/ })).toBeNull();
  });

  it("rejects typing an amount that alone fits the balance but would overflow once the fee is added", async () => {
    const send = routedSend({
      getBalance: () => "1000000000000", // 1 AR
      getArFee: () => "50000000000", // 0.05 AR
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    await screen.findByRole("button", { name: /^Max:/ });
    const amountInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    // The whole balance, with nothing left over for the fee — the compose
    // step's own input clamp (matching its fee-aware Max) rejects it rather
    // than letting it reach Continue's balance check.
    fireEvent.change(amountInput, { target: { value: "1" } });
    expect(amountInput.value).toBe("");
  });

  it("advances to review when the recipient-specific fee still leaves the amount affordable", async () => {
    const send = routedSend({
      getBalance: () => "1000000000000", // 1 AR
      getArFee: () => "50000000000", // 0.05 AR (rough, recipient-less quote)
      estimateTransfer: () => ({ fee: "50000000000", firstSeenRecipient: false }),
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.change(screen.getByPlaceholderText("Paste an address"), {
      target: { value: RECENT_RECIPIENT_A },
    });
    // Right at the fee-adjusted Max — allowed.
    const maxButton = await screen.findByRole("button", { name: /^Max:/ });
    fireEvent.click(maxButton);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Review send")).toBeTruthy());
  });

  it("blocks advancing to review when the recipient-specific fee (larger than the rough getArFee quote) pushes the total over the balance", async () => {
    // getArFee's rough, recipient-less quote (0.05 AR) underestimates for a
    // first-seen recipient — estimateTransfer's real quote (0.2 AR) is
    // larger, and the total then exceeds the balance even though the
    // amount fit under the rough Max. Continue must not advance to review.
    const send = routedSend({
      getBalance: () => "1000000000000", // 1 AR
      getArFee: () => "50000000000", // 0.05 AR
      estimateTransfer: () => ({ fee: "200000000000", firstSeenRecipient: true }), // 0.2 AR
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });

    fireEvent.change(screen.getByPlaceholderText("Paste an address"), {
      target: { value: RECENT_RECIPIENT_A },
    });
    // Right at the rough fee-adjusted Max (0.95 AR) — passes the client
    // clamp and the pre-estimate check, but not the post-estimate one.
    const maxButton = await screen.findByRole("button", { name: /^Max:/ });
    fireEvent.click(maxButton);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("more than your current balance");
    expect(screen.queryByText("Review send")).toBeNull();
  });

  it("does not apply the AR fee to an AO token's Max or balance check", async () => {
    const send = routedSend({
      getTokenBalances: () => [AO_TOKEN],
      getArFee: () => "50000000000",
    });
    renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: AO_TOKEN, onBack: vi.fn(), onDone: vi.fn() });

    const maxButton = await screen.findByRole("button", { name: /^Max:/ });
    // AO_TOKEN.quantity is 5000000 at denomination 6 -> "5", unaffected by the AR fee.
    expect(maxButton.textContent).toContain("5");
    expect(maxButton.textContent).not.toContain("4.95");
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
    expect(recipientRows[0]!.textContent).toContain(RECENT_RECIPIENT_B.slice(0, 6));
    expect(recipientRows[1]!.textContent).toContain(RECENT_RECIPIENT_A.slice(0, 6));
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
      return routedSend({})(message, undefined);
    }) as RuntimePort["send"];
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

    // Leaves room for the default fee mock's fee, unlike the whole balance.
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Review send")).toBeTruthy());
    expect(screen.getByText(RECENT_RECIPIENT_A)).toBeTruthy();
  });
});
