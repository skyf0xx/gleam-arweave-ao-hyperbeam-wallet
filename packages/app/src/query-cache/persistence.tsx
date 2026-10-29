import { useEffect, useState, type ReactNode } from "react";
import { IsRestoringProvider, type Query, type QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";
import type { QueryCachePort } from "../app-platform/types";
import { DISPLAY_SETTINGS_QUERY_KEY } from "../display-settings";

/** A restored cache older than this is dropped. Stored queries keep this `gcTime`, so unseen ones survive to the next save. */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SAVE_THROTTLE_MS = 1000;

/** Second key element of the active wallet's queries (`[address, kind, ...]`) that may be stored. */
const WALLET_QUERY_KINDS: ReadonlySet<string> = new Set(["balances", "activity", "collectibles", "portfolioHistory"]);

/**
 * First key element of queries that aren't per wallet. Display settings go
 * along so a restored total is priced in the right currency, and a user who
 * hid their balances never sees them flash before the setting loads.
 */
const SHARED_QUERY_KINDS: ReadonlySet<string> = new Set(["tokenPrices", DISPLAY_SETTINGS_QUERY_KEY[0]]);

/**
 * Whether a query belongs in `address`'s stored cache: only an allowlisted
 * read that has data. The client also holds other wallets' queries after a
 * switch, so a wallet's cache takes only its own address's entries.
 */
export function shouldPersistQuery(query: Pick<Query, "queryKey" | "state">, address: string): boolean {
  // A failed refetch keeps its last data, which is still the best figure to show next time.
  if (query.state.data === undefined) return false;
  const [first, second] = query.queryKey;
  if (first === address) return typeof second === "string" && WALLET_QUERY_KINDS.has(second);
  return typeof first === "string" && SHARED_QUERY_KINDS.has(first);
}

/** A query whose refetch failed is stored as the success it last was, so a restore shows its data rather than an error. */
function asLastGoodData(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((query) =>
    query.state.status === "error"
      ? { ...query, state: { ...query.state, status: "success" as const, error: null, fetchFailureReason: null, fetchFailureCount: 0 } }
      : query,
  );
  return { ...client, clientState: { ...client.clientState, queries } };
}

export function createQueryCachePersister(port: QueryCachePort, walletId: string): Persister {
  return {
    persistClient: (client) => port.set(walletId, JSON.stringify(asLastGoodData(client))),
    restoreClient: async () => {
      const stored = await port.get(walletId);
      return stored === null ? undefined : JSON.parse(stored);
    },
    removeClient: () => port.remove(walletId),
  };
}

export interface QueryCachePersistenceProps {
  client: QueryClient;
  port: QueryCachePort;
  walletId: string;
  address: string;
  /** Discards a cache written by another build, whose data shapes may differ. */
  buster: string;
  children: ReactNode;
}

/**
 * Restores the wallet's stored queries before its screens subscribe, then
 * saves them as they change. Mounted only once the wallet is unlocked, and
 * keyed by wallet so a switch restores the other wallet's cache.
 */
export function QueryCachePersistence({ client, port, walletId, address, buster, children }: QueryCachePersistenceProps) {
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    for (const kind of WALLET_QUERY_KINDS) client.setQueryDefaults([address, kind], { gcTime: QUERY_CACHE_MAX_AGE_MS });
    for (const kind of SHARED_QUERY_KINDS) client.setQueryDefaults([kind], { gcTime: QUERY_CACHE_MAX_AGE_MS });
    const persister = createQueryCachePersister(port, walletId);
    let active = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const save = () => {
      saveTimer = undefined;
      persistQueryClientSave({
        queryClient: client,
        persister,
        buster,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => shouldPersistQuery(query, address),
          shouldDehydrateMutation: () => false,
        },
      }).catch((error: unknown) => console.error("Couldn't save the query cache.", error));
    };

    const restoreStartedAt = Date.now();
    persistQueryClientRestore({
      queryClient: client,
      persister,
      buster,
      maxAge: QUERY_CACHE_MAX_AGE_MS,
      // Hydrated queries no screen has observed yet don't pick up the defaults above on their own.
      hydrateOptions: { defaultOptions: { queries: { gcTime: QUERY_CACHE_MAX_AGE_MS } } },
    })
      // A restored copy is shown as cached until a live read replaces it, so each one is read again on open,
      // even where its staleTime (the chart's, the settings') would still call it fresh.
      .then(() =>
        client.invalidateQueries({
          predicate: (query) => shouldPersistQuery(query, address) && query.state.dataUpdatedAt < restoreStartedAt,
          refetchType: "none",
        }),
      )
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        setRestoring(false);
        unsubscribe = client.getQueryCache().subscribe((event) => {
          if (event.type !== "added" && event.type !== "removed" && event.type !== "updated") return;
          saveTimer ??= setTimeout(save, SAVE_THROTTLE_MS);
        });
      });

    return () => {
      active = false;
      unsubscribe?.();
      // Dropped rather than flushed: the wallet may have just been removed, and a late write would bring its cache back.
      if (saveTimer !== undefined) clearTimeout(saveTimer);
    };
  }, [client, port, walletId, address, buster]);

  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>;
}
