import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { dehydrate, QueryClient, type Query } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { memoryQueryCache } from "../app-platform/testing";
import { QUERY_CACHE_MAX_AGE_MS, QueryCachePersistence, shouldPersistQuery } from "./persistence";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ADDRESS_A = "a".repeat(43);
const ADDRESS_B = "b".repeat(43);
const BALANCES = { arBalance: "2500000000000", tokenBalances: [] };

function query(queryKey: readonly unknown[], status: "success" | "error" | "pending" = "success") {
  const data = status === "pending" ? undefined : BALANCES;
  return { queryKey, state: { status, data } } as unknown as Pick<Query, "queryKey" | "state">;
}

function storedClient(buster: string, address: string, timestamp = Date.now()): string {
  const source = new QueryClient();
  source.setQueryData([address, "balances"], BALANCES);
  const persisted: PersistedClient = { buster, timestamp, clientState: dehydrate(source) };
  return JSON.stringify(persisted);
}

async function mount(client: QueryClient, cache: ReturnType<typeof memoryQueryCache>, walletId: string, address: string, buster = "1.2.3") {
  await act(async () => {
    render(
      <QueryCachePersistence client={client} port={cache} walletId={walletId} address={address} buster={buster}>
        <div />
      </QueryCachePersistence>,
    );
  });
}

describe("shouldPersistQuery", () => {
  it("keeps the active wallet's balances, activity, collectibles and chart, and prices and display settings", () => {
    for (const key of [
      [ADDRESS_A, "balances"],
      [ADDRESS_A, "activity"],
      [ADDRESS_A, "collectibles"],
      [ADDRESS_A, "portfolioHistory", "7D", "wallet", "USD"],
      ["tokenPrices", "USD"],
      ["displaySettings"],
    ]) {
      expect(shouldPersistQuery(query(key), ADDRESS_A), JSON.stringify(key)).toBe(true);
    }
  });

  it("leaves out every key that isn't on the list", () => {
    for (const key of [
      ["contacts"],
      ["wallets", "state"],
      ["points", "memberships"],
      ["points", "inviteUnlock"],
      ["networkSettings"],
      ["arFee"],
      ["announcements", "list"],
      ["activeSite"],
      [ADDRESS_A, "lockSettings"],
      [ADDRESS_A],
    ]) {
      expect(shouldPersistQuery(query(key), ADDRESS_A), JSON.stringify(key)).toBe(false);
    }
  });

  it("leaves out another wallet's queries and anything with no data", () => {
    expect(shouldPersistQuery(query([ADDRESS_B, "balances"]), ADDRESS_A)).toBe(false);
    expect(shouldPersistQuery(query([ADDRESS_A, "balances"], "pending"), ADDRESS_A)).toBe(false);
    const failedFirstRead = { queryKey: [ADDRESS_A, "balances"], state: { status: "error", data: undefined } };
    expect(shouldPersistQuery(failedFirstRead as unknown as Pick<Query, "queryKey" | "state">, ADDRESS_A)).toBe(false);
  });

  it("keeps the last data of a query whose refetch failed", () => {
    expect(shouldPersistQuery(query([ADDRESS_A, "balances"], "error"), ADDRESS_A)).toBe(true);
  });
});

describe("QueryCachePersistence", () => {
  it("restores the wallet's own cache", async () => {
    const cache = memoryQueryCache(new Map([["w1", storedClient("1.2.3", ADDRESS_A)]]));
    const client = new QueryClient();
    await mount(client, cache, "w1", ADDRESS_A);
    expect(client.getQueryData([ADDRESS_A, "balances"])).toEqual(BALANCES);
  });

  it("marks a restored copy stale even within its staleTime, so it is read again on open", async () => {
    const source = new QueryClient();
    const chartKey = [ADDRESS_A, "portfolioHistory", "7D", "wallet", "USD"];
    source.setQueryData(chartKey, { points: [] }, { updatedAt: Date.now() - 60_000 });
    const persisted: PersistedClient = { buster: "1.2.3", timestamp: Date.now(), clientState: dehydrate(source) };
    const client = new QueryClient();
    await mount(client, memoryQueryCache(new Map([["w1", JSON.stringify(persisted)]])), "w1", ADDRESS_A);
    expect(client.getQueryState(chartKey)?.isInvalidated).toBe(true);
  });

  it("keeps each wallet's cache under its own id", async () => {
    vi.useFakeTimers();
    const walletACache = storedClient("1.2.3", ADDRESS_A);
    const cache = memoryQueryCache(new Map([["w1", walletACache]]));
    const client = new QueryClient();
    client.setQueryData([ADDRESS_A, "balances"], BALANCES);
    await mount(client, cache, "w2", ADDRESS_B);
    expect(client.getQueryData([ADDRESS_B, "balances"])).toBeUndefined();

    client.setQueryData([ADDRESS_B, "balances"], { arBalance: "1", tokenBalances: [] });
    client.setQueryData(["contacts"], [{ name: "Ann" }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    const saved = JSON.parse(cache.entries.get("w2") ?? "null") as PersistedClient;
    expect(saved.buster).toBe("1.2.3");
    expect(saved.clientState.queries.map((entry) => entry.queryKey)).toEqual([[ADDRESS_B, "balances"]]);
    expect(saved.clientState.mutations).toEqual([]);
    expect(cache.entries.get("w1")).toBe(walletACache);
  });

  it("keeps a failed refetch's last data in storage, restored as a success", async () => {
    vi.useFakeTimers();
    const cache = memoryQueryCache();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mount(client, cache, "w1", ADDRESS_A);
    client.setQueryData([ADDRESS_A, "balances"], BALANCES);
    await act(async () => {
      await client
        .fetchQuery({ queryKey: [ADDRESS_A, "balances"], queryFn: () => Promise.reject(new Error("offline")), staleTime: 0 })
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(client.getQueryState([ADDRESS_A, "balances"])?.status).toBe("error");
    cleanup();
    vi.useRealTimers();

    const restored = new QueryClient();
    await mount(restored, cache, "w1", ADDRESS_A);
    expect(restored.getQueryData([ADDRESS_A, "balances"])).toEqual(BALANCES);
    expect(restored.getQueryState([ADDRESS_A, "balances"])?.status).toBe("success");
  });

  it("gives only the stored queries the long gcTime", async () => {
    const client = new QueryClient();
    await mount(client, memoryQueryCache(), "w1", ADDRESS_A);
    expect(client.getQueryDefaults([ADDRESS_A, "balances"]).gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
    expect(client.getQueryDefaults(["tokenPrices", "USD"]).gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
    expect(client.getQueryDefaults(["contacts"]).gcTime).toBeUndefined();
    expect(client.getQueryDefaults([ADDRESS_B, "balances"]).gcTime).toBeUndefined();
  });

  it("discards a cache written by another version", async () => {
    const cache = memoryQueryCache(new Map([["w1", storedClient("1.0.0", ADDRESS_A)]]));
    const client = new QueryClient();
    await mount(client, cache, "w1", ADDRESS_A, "1.2.3");
    expect(client.getQueryData([ADDRESS_A, "balances"])).toBeUndefined();
    expect(cache.entries.has("w1")).toBe(false);
  });

  it("discards a cache older than a week", async () => {
    const cache = memoryQueryCache(new Map([["w1", storedClient("1.2.3", ADDRESS_A, Date.now() - QUERY_CACHE_MAX_AGE_MS - 1)]]));
    const client = new QueryClient();
    await mount(client, cache, "w1", ADDRESS_A);
    expect(client.getQueryData([ADDRESS_A, "balances"])).toBeUndefined();
  });

  it("drops a pending save when it unmounts", async () => {
    vi.useFakeTimers();
    const cache = memoryQueryCache();
    const client = new QueryClient();
    await mount(client, cache, "w1", ADDRESS_A);
    client.setQueryData([ADDRESS_A, "balances"], BALANCES);
    cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(cache.entries.has("w1")).toBe(false);
  });
});
