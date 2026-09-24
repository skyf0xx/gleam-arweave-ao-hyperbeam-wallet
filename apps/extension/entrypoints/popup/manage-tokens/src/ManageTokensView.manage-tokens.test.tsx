import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort, TokenBalance } from "@gleam/core";
import { ManageTokensView } from "./ManageTokensView";

afterEach(() => {
  cleanup();
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const PROC_1 = "hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY";

const BALANCE_1: TokenBalance = {
  address: "addr1",
  processId: PROC_1,
  ticker: "wUSDC",
  denomination: 6,
  quantity: "1000000",
};

describe("ManageTokensView", () => {
  it("loads the watch list and shows each row's resolved ticker and balance, not just the raw process id", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [PROC_1];
      if (type === "getTokenBalances") return [BALANCE_1];
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("wUSDC")).toBeTruthy());
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("previews a pasted process id (read-only) before it's added to the list", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") return BALANCE_1;
      throw new Error(`Unexpected message type "${type}" should not be called before confirming`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });
    fireEvent.click(screen.getByText("Preview"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "previewWatchedToken",
        payload: { address: "addr1", processId: PROC_1 },
      }),
    );
    // Preview shown, but not yet stored: addWatchedToken must not have been called.
    await waitFor(() => expect(screen.getByText(`Add ${BALANCE_1.ticker}`)).toBeTruthy());
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "addWatchedToken" }));
  });

  it("confirming Add stores the previewed token and refreshes the main screen's balances cache", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") return BALANCE_1;
      if (type === "addWatchedToken") return BALANCE_1;
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    const { queryClient } = renderWithClient(
      <ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });
    fireEvent.click(screen.getByText("Preview"));

    await waitFor(() => expect(screen.getByText(`Add ${BALANCE_1.ticker}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Add ${BALANCE_1.ticker}`));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "addWatchedToken",
        payload: { address: "addr1", processId: PROC_1 },
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["addr1", "balances"] });
  });

  it("shows a rejection's error instead of previewing an invalid process id", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") throw new Error("No HyperBEAM peer configured.");
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: "bad-id" } });
    fireEvent.click(screen.getByText("Preview"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No HyperBEAM peer configured/));
  });

  it("removing a watched token calls removeWatchedToken, drops it from the list, and refreshes balances", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [PROC_1];
      if (type === "getTokenBalances") return [BALANCE_1];
      if (type === "removeWatchedToken") return undefined;
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    const { queryClient } = renderWithClient(
      <ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => expect(screen.getByText("wUSDC")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove wUSDC" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "removeWatchedToken",
        payload: { address: "addr1", processId: PROC_1 },
      }),
    );
    await waitFor(() => expect(screen.queryByText("wUSDC")).toBeNull());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["addr1", "balances"] });
  });
});
