import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ActivityPage, RuntimeMessage, RuntimePort, TokenBalance, Winston } from "@gleam/core";
import { useBalances } from "./useBalances";
import { useActivity } from "./useActivity";
import { useSubmitTransfer } from "./useSubmitTransfer";
import { validateSendAmount } from "./validateSendAmount";
import { walletQueryKeys } from "./queryKeys";

function makeRuntime(handlers: Partial<Record<string, (payload: unknown) => unknown>>): RuntimePort {
  return {
    send: vi.fn(async (message: RuntimeMessage<unknown>) => {
      const handler = handlers[message.type];
      if (!handler) throw new Error(`unhandled message type: ${message.type}`);
      return handler(message.payload);
    }),
  } as unknown as RuntimePort;
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const AR_BALANCE: Winston = "1000000000000";
const TOKENS: TokenBalance[] = [
  { address: "addr", processId: "proc-1", ticker: "TEST", denomination: 6, quantity: "500000" },
];
const ACTIVITY: ActivityPage = { entries: [], cursor: null };

describe("useBalances", () => {
  it("fetches AR and token balances via runtime.send, keyed by address", async () => {
    const getBalance = vi.fn().mockReturnValue(AR_BALANCE);
    const getTokenBalances = vi.fn().mockReturnValue(TOKENS);
    const runtime = makeRuntime({ getBalance, getTokenBalances });
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useBalances(runtime, "addr"), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ arBalance: AR_BALANCE, tokenBalances: TOKENS });
    expect(getBalance).toHaveBeenCalledWith({ address: "addr" });
    expect(getTokenBalances).toHaveBeenCalledWith({ address: "addr" });

    expect(
      queryClient.getQueryData(walletQueryKeys.balances("addr")),
    ).toEqual({ arBalance: AR_BALANCE, tokenBalances: TOKENS });
  });

  it("shares one cache entry across two hook instances for the same address (no duplicate races)", async () => {
    const getBalance = vi.fn().mockReturnValue(AR_BALANCE);
    const getTokenBalances = vi.fn().mockReturnValue(TOKENS);
    const runtime = makeRuntime({ getBalance, getTokenBalances });
    const queryClient = new QueryClient();
    const Wrapper = wrapper(queryClient);

    const first = renderHook(() => useBalances(runtime, "addr"), { wrapper: Wrapper });
    const second = renderHook(() => useBalances(runtime, "addr"), { wrapper: Wrapper });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(getBalance).toHaveBeenCalledTimes(1);
    expect(getTokenBalances).toHaveBeenCalledTimes(1);
  });
});

describe("useActivity", () => {
  it("fetches the merged activity feed via runtime.send, keyed by address", async () => {
    const getActivity = vi.fn().mockReturnValue(ACTIVITY);
    const runtime = makeRuntime({ getActivity });
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useActivity(runtime, "addr"), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ACTIVITY);
    expect(getActivity).toHaveBeenCalledWith({ address: "addr" });
  });
});

describe("useSubmitTransfer", () => {
  it("submits via runtime.send and invalidates balances + activity for the sender address on success", async () => {
    const getBalance = vi.fn().mockReturnValue(AR_BALANCE);
    const getTokenBalances = vi.fn().mockReturnValue(TOKENS);
    const getActivity = vi.fn().mockReturnValue(ACTIVITY);
    const submitTransfer = vi.fn().mockReturnValue({ txId: "tx-1" });
    const runtime = makeRuntime({ getBalance, getTokenBalances, getActivity, submitTransfer });
    const queryClient = new QueryClient();
    const Wrapper = wrapper(queryClient);

    const balances = renderHook(() => useBalances(runtime, "addr"), { wrapper: Wrapper });
    const activity = renderHook(() => useActivity(runtime, "addr"), { wrapper: Wrapper });
    await waitFor(() => expect(balances.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(activity.result.current.isSuccess).toBe(true));

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSubmitTransfer(runtime, "addr"), { wrapper: Wrapper });

    await act(async () => {
      const res = await result.current.mutateAsync({
        walletId: "wallet-1",
        recipient: "recipient-address",
        token: null,
        amount: "1000",
        fee: "100",
      });
      expect(res).toEqual({ txId: "tx-1" });
    });

    expect(submitTransfer).toHaveBeenCalledWith({
      walletId: "wallet-1",
      recipient: "recipient-address",
      token: null,
      amount: "1000",
      fee: "100",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletQueryKeys.balances("addr") });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: walletQueryKeys.activity("addr") });
  });

  it("does not invalidate on failure", async () => {
    const submitTransfer = vi.fn().mockRejectedValue(new Error("insufficient balance"));
    const runtime = makeRuntime({ submitTransfer });
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSubmitTransfer(runtime, "addr"), { wrapper: wrapper(queryClient) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          walletId: "wallet-1",
          recipient: "recipient-address",
          token: null,
          amount: "1000",
          fee: "100",
        }),
      ).rejects.toThrow("insufficient balance");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("validateSendAmount", () => {
  const balances = { arBalance: "1000", tokenBalances: TOKENS };

  it("returns null while balances haven't loaded yet", () => {
    expect(validateSendAmount("999999999", null, undefined)).toBeNull();
  });

  it("returns null for an AR amount within balance", () => {
    expect(validateSendAmount("500", null, balances)).toBeNull();
  });

  it("returns an inline error for an AR amount over balance", () => {
    expect(validateSendAmount("1001", null, balances)).toBe("That's more than your current balance.");
  });

  it("returns null for an AO token amount within balance", () => {
    expect(validateSendAmount("500000", TOKENS[0], balances)).toBeNull();
  });

  it("returns an inline error for an AO token amount over balance", () => {
    expect(validateSendAmount("500001", TOKENS[0], balances)).toBe("That's more than your current balance.");
  });

  it("returns null for a token with no matching balance entry (can't yet judge affordability)", () => {
    const unknownToken: TokenBalance = { address: "addr", processId: "unknown", ticker: "X", denomination: 0, quantity: "0" };
    expect(validateSendAmount("1", unknownToken, balances)).toBeNull();
  });
});
