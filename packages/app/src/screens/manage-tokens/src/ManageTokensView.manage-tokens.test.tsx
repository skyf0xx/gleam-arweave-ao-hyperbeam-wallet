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
  name: null,
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

  it("shows a watched token's logo, and the plain row when it has none", async () => {
    const withLogo: TokenBalance = { ...BALANCE_1, logoUrl: "https://arweave.net/logo-tx" };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [PROC_1];
      if (type === "getTokenBalances") return [withLogo];
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("wUSDC")).toBeTruthy());
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://arweave.net/logo-tx");
  });

  it("previews a pasted process id at once (read-only), before it's added to the list", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") return BALANCE_1;
      throw new Error(`Unexpected message type "${type}" should not be called before confirming`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });

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

  it("shows the background's rejection instead of a preview", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") throw new Error("No process with that id is on Arweave yet.");
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No process with that id/));
  });

  it("explains a malformed id without asking the background", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: "bad-id" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(screen.getByPlaceholderText("AO process id"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/43 letters.*this is 6/));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "previewWatchedToken" }));
  });

  it("lets a token whose balance can't be read still be added, in plain words", async () => {
    const unreadable: TokenBalance = { ...BALANCE_1, available: false, unavailableReason: "Couldn't read your wUSDC balance." };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") return unreadable;
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });

    await waitFor(() => expect(screen.getByText(/can't read this token right now/)).toBeTruthy());
    expect(screen.getByText(/You can still add it/)).toBeTruthy();
    expect(screen.getByText(/can't read this token right now/).parentElement?.getAttribute("title")).toBe("Couldn't read your wUSDC balance.");
    expect((screen.getByText("Add wUSDC").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shortens the process id of a token whose details can't be read", async () => {
    const unknown: TokenBalance = { ...BALANCE_1, ticker: PROC_1, name: null, available: false };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [];
      if (type === "previewWatchedToken") return unknown;
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByPlaceholderText("AO process id")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("AO process id"), { target: { value: PROC_1 } });

    await waitFor(() => expect(screen.getByText("Add token")).toBeTruthy());
    expect(screen.queryByText(PROC_1)).toBeNull();
  });

  it("lists discovered tokens separately, and hiding one calls removeWatchedToken", async () => {
    const found: TokenBalance = { ...BALANCE_1, ticker: "FODDER", source: "discovered" };
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getWatchedTokens") return [];
      if (type === "getTokenBalances") return [found];
      if (type === "removeWatchedToken") return undefined;
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ManageTokensView runtime={fakeRuntime({ send })} address="addr1" onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Found in your wallet")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Ignore FODDER"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "removeWatchedToken", payload: { address: "addr1", processId: PROC_1 } }),
    );
    await waitFor(() => expect(screen.queryByText("Found in your wallet")).toBeNull());
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
