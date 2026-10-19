import { browser } from "wxt/browser";
import { discoverCollectibles, getTokenBalance, getTransferOutcome } from "@gleam/core/src/ao/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { queryActivityTransactions, queryAoTransferActivity } from "@gleam/core/src/arweave/graphql.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import {
  AO_TOKEN,
  AR_TOKEN,
  DEFAULT_TOKEN_REGISTRY,
  buildPriceAtFromSeries,
  estimateHistoricalPortfolioValue,
  getHistoricalUsdPrices,
  getUsdPrice,
  isRegisteredProcessId,
  resolveUnregisteredTokenMetadata,
} from "@gleam/core/src/pricing/index.ts";
import { DEFAULT_HYPERBEAM_PEER_URLS, POINTS_API_URL } from "@gleam/core";
import type {
  ActivityEntry,
  ActivityPage,
  Collectible,
  HyperBeamPeer,
  NetworkSettings,
  PortfolioHistory,
  PortfolioHistoryRange,
  PortfolioScope,
  StoragePort,
  TokenBalance,
  TokenBalanceRequest,
  TokenBalanceResult,
  TokenMetadata,
  TokenPrice,
  UserToken,
  UserTokensOptions,
  UserTokensResult,
  Wallet,
  Winston,
} from "@gleam/core";

/**
 * Background-side implementation of `ProtocolMap`'s read methods
 * (`getBalance`/`getTokenBalances`/`getActivity`) — same
 * constructor-injected-`StoragePort` shape as
 * `WalletLifecycleHandler` (`handlers/wallet-lifecycle.ts`), for the same
 * hexagonal reason: this file knows `StoragePort`'s shape, never
 * `wxt/utils/storage`.
 *
 * Storage schema this handler owns:
 * - `local:networkSettings` — `NetworkSettings`, defaulting to
 *   `arweave.net` with no HyperBEAM peers configured (an AO balance read
 *   with no active peer throws a named "no HyperBEAM peer configured"
 *   error rather than silently returning a zero balance — a value this
 *   handler can't compute is surfaced as unavailable, not as a plausible
 *   default).
 * - `local:activityLog:{address}` — `ActivityEntry[]`, the local
 *   append-only action log `handlers/transfer.ts` writes optimistic
 *   entries into. Read-only from this handler's side; `transfer.ts` owns
 *   writing it. Keyed per-address since the log is scoped to whichever
 *   wallet's activity is being viewed.
 * - `local:wallets` / `local:activeWalletId` — owned by
 *   `handlers/wallet-lifecycle.ts` (`WalletLifecycleHandler`'s own doc
 *   comment), read-only here. `getPortfolioHistory`'s `ProtocolMap`
 *   signature takes only `{ range }` — no address, unlike every other
 *   read in this file — so this handler resolves "whose balance to
 *   price" itself from these two keys rather than inventing an address
 *   param the contract doesn't have. `Wallet.address` is plaintext (only
 *   `encryptedKeyfile` is encrypted, per the `Wallet` model's own doc
 *   comment), so this needs no vault/decryption access — still only
 *   `StoragePort`, the same hexagonal boundary every other method in
 *   this file already respects.
 *
 * `getTokenBalances`'s AO process list: resolved against
 * `local:watchedProcessIds:{address}` (a simple `string[]`, defaulting to
 * empty). The default AO process id is always included in
 * `getTokenBalances`'s result regardless of this list's contents (see
 * `DEFAULT_AO_PROCESS_ID`) and is never itself stored in it.
 */
const NETWORK_SETTINGS_KEY = "local:networkSettings";
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";
const WATCHED_PROCESS_IDS_KEY_PREFIX = "local:watchedProcessIds:";
const TOKEN_METADATA_KEY_PREFIX = "local:tokenMetadata:";
const COLLECTIBLES_KEY_PREFIX = "local:collectibles:";
// Holdings change rarely and discovery is dozens of requests, so a popup
// open within this window reuses the last result.
const COLLECTIBLES_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_PAGE_LIMIT = 50;
const WALLETS_KEY = "local:wallets";
const ACTIVE_WALLET_ID_KEY = "local:activeWalletId";
const WINSTON_PER_AR = 1_000_000_000_000;

const PORTFOLIO_HISTORY_RANGES: readonly PortfolioHistoryRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

function periodLabelForRange(range: PortfolioHistoryRange): string {
  switch (range) {
    case "24H":
      return "Last 24 hours";
    case "7D":
      return "Last 7 days";
    case "1M":
      return "Last 30 days";
    case "1Y":
      return "Last 12 months";
    case "ALL":
      return "All time";
  }
}

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: DEFAULT_HYPERBEAM_PEER_URLS.map((url) => ({ url, enabled: true })),
  activePeerUrl: DEFAULT_HYPERBEAM_PEER_URLS[0] ?? null,
};

/**
 * The AO token (pricing's AO_TOKEN, packages/core's single source of
 * truth for this id) is always shown on the Tokens tab regardless of
 * what's in a user's watch list, so its balance must always be read —
 * `local:watchedProcessIds` has no writer anywhere in the extension yet, so
 * relying on it alone left AO balance reads permanently empty.
 */
const DEFAULT_AO_PROCESS_ID = AO_TOKEN.processId as string;

/**
 * `getTokenBalance` echoes the process id as `ticker` when a HyperBEAM
 * balance response carries no ticker field (see `ao/balance.ts`'s
 * `parseBalanceResponse`). For any process with a manually-verified
 * ticker in `DEFAULT_TOKEN_REGISTRY` (e.g. AO), that known identity takes
 * precedence over the fallback.
 */
function withRegisteredTicker(balance: TokenBalance): TokenBalance {
  const registered = DEFAULT_TOKEN_REGISTRY.find((token) => token.processId === balance.processId);
  if (!registered) return balance;
  return {
    ...balance,
    ticker: balance.ticker === balance.processId ? registered.ticker : balance.ticker,
    name: registered.name,
  };
}

/**
 * Placeholder row for a process id whose `getTokenBalance` HyperBEAM read
 * itself failed (peer error, timeout, unrecognized response shape) —
 * `getTokenBalances` uses `Promise.allSettled` so one such failure marks
 * only this row unavailable rather than rejecting the whole call and
 * blanking every other token's balance too. Ticker falls back to the raw
 * process id, matching `getTokenBalance`'s own no-ticker convention, so an
 * unavailable row still identifies which token failed.
 */
function unavailableTokenBalance(processId: string, address: string): TokenBalance {
  return {
    address,
    processId,
    ticker: processId,
    denomination: 0,
    name: null,
    quantity: "0",
    available: false,
  };
}

function isValidTokenMetadata(value: unknown): value is TokenMetadata {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.processId === "string" &&
    (candidate.denomination === null || typeof candidate.denomination === "number") &&
    (candidate.ticker === null || typeof candidate.ticker === "string") &&
    (candidate.name === null || typeof candidate.name === "string") &&
    (candidate.description === null || typeof candidate.description === "string") &&
    (candidate.logo === null || typeof candidate.logo === "string") &&
    (candidate.totalSupply === null || typeof candidate.totalSupply === "string")
  );
}

function isValidHyperBeamPeer(value: unknown): value is HyperBeamPeer {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === "string" && typeof candidate.enabled === "boolean";
}

function isValidNetworkSettings(value: unknown): value is NetworkSettings {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gatewayUrl === "string" &&
    Array.isArray(candidate.peers) &&
    candidate.peers.every(isValidHyperBeamPeer) &&
    (candidate.activePeerUrl === null || typeof candidate.activePeerUrl === "string")
  );
}

function isValidActivityEntry(value: unknown): value is ActivityEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.txId === "string" &&
    (candidate.type === "send" || candidate.type === "receive" || candidate.type === "upload") &&
    (candidate.status === "pending" ||
      candidate.status === "confirmed" ||
      candidate.status === "failed") &&
    typeof candidate.address === "string" &&
    (candidate.amount === null || typeof candidate.amount === "string") &&
    Array.isArray(candidate.tags) &&
    typeof candidate.timestamp === "number" &&
    (candidate.error === undefined || candidate.error === null || typeof candidate.error === "string")
  );
}

interface CollectiblesCache {
  savedAt: number;
  collectibles: Collectible[];
}

function isCollectiblesCache(value: unknown): value is CollectiblesCache {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.savedAt === "number" &&
    Array.isArray(candidate.collectibles) &&
    candidate.collectibles.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).name === "string",
    )
  );
}

export class ReadsHandler {
  private readonly collectiblesInFlight = new Map<string, Promise<Collectible[]>>();

  /** `pricesApiUrl` is the Gleam server, which proxies CoinGecko/CoinPaprika for users who can't reach them. */
  constructor(
    private readonly storage: StoragePort,
    private readonly pricesApiUrl: string = POINTS_API_URL,
  ) {}

  async loadNetworkSettings(): Promise<NetworkSettings> {
    const raw = await this.storage.get<unknown>(NETWORK_SETTINGS_KEY);
    return isValidNetworkSettings(raw) ? raw : DEFAULT_NETWORK_SETTINGS;
  }

  /**
   * `ProtocolMap.getNetworkSettings`'s backing read — same shape as
   * `loadNetworkSettings` (used internally by `getBalance`/
   * `getTokenBalances`/`getActivity`), exposed under the exact protocol
   * method name so the background dispatcher has a call site to wire
   * `getNetworkSettings` to.
   */
  async getNetworkSettings(): Promise<NetworkSettings> {
    return this.loadNetworkSettings();
  }

  async loadActivityLog(address: string): Promise<ActivityEntry[]> {
    const raw = await this.storage.get<unknown>(`${ACTIVITY_LOG_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidActivityEntry);
  }

  async loadWatchedProcessIds(address: string): Promise<string[]> {
    const raw = await this.storage.get<unknown>(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === "string");
  }

  /**
   * Cached per wallet in `local:collectibles:{address}`. A failed
   * rediscovery serves the stale cache instead of an error; with no cache
   * it throws, so the popup can show its error state. Concurrent calls for
   * one wallet share one discovery.
   */
  async getCollectibles(req: { address: string; refresh?: boolean }): Promise<Collectible[]> {
    const key = `${COLLECTIBLES_KEY_PREFIX}${req.address}`;
    const raw = await this.storage.get<unknown>(key);
    const cached = isCollectiblesCache(raw) ? raw : null;
    if (cached && req.refresh !== true && Date.now() - cached.savedAt < COLLECTIBLES_TTL_MS) {
      return cached.collectibles;
    }

    const running = this.collectiblesInFlight.get(req.address);
    if (running) return running;

    const run = (async () => {
      try {
        const settings = await this.loadNetworkSettings();
        if (settings.activePeerUrl === null) {
          throw new Error("No HyperBEAM peer configured. Add one in Network settings to find collectibles.");
        }
        const collectibles = await discoverCollectibles({
          address: req.address,
          gatewayUrl: settings.gatewayUrl,
          peerUrl: settings.activePeerUrl,
        });
        await this.storage.set<CollectiblesCache>(key, { savedAt: Date.now(), collectibles });
        return collectibles;
      } catch (error) {
        if (cached) return cached.collectibles;
        throw error;
      } finally {
        this.collectiblesInFlight.delete(req.address);
      }
    })();
    this.collectiblesInFlight.set(req.address, run);
    return run;
  }

  /**
   * Drops a collectible the wallet just sent from its cache. Its balance
   * only moves once the asset process reads the L1 transaction, so a
   * rediscovery right after the send would still list it.
   */
  async forgetCollectible(req: { address: string; id: string }): Promise<void> {
    const key = `${COLLECTIBLES_KEY_PREFIX}${req.address}`;
    const raw = await this.storage.get<unknown>(key);
    if (!isCollectiblesCache(raw)) return;
    await this.storage.set<CollectiblesCache>(key, {
      ...raw,
      collectibles: raw.collectibles.filter((collectible) => collectible.id !== req.id),
    });
  }

  async getWatchedTokens(req: { address: string }): Promise<string[]> {
    return this.loadWatchedProcessIds(req.address);
  }

  /**
   * For a `TokenBalance` whose process isn't in `DEFAULT_TOKEN_REGISTRY`
   * (so `withRegisteredTicker` had nothing to apply), resolves ticker,
   * denomination and name directly from the process's spawn tags via the
   * gateway's GraphQL endpoint (`resolveUnregisteredTokenMetadata` —
   * `core/pricing/token-sources.ts`) rather than leaving the balance
   * identified only by its raw process id. This is purely additive
   * identification for watched-but-unregistered tokens: the balance
   * quantity itself still comes only from the existing HyperBEAM
   * `~process@1.0` compute path (`getTokenBalance`), and a registered
   * token's identity (checked first) is never overridden by this lookup.
   *
   * Denomination for a non-AO process always comes from this metadata
   * lookup, never from `getTokenBalance`'s AO-specific denomination-12
   * default, which is only actually correct for the AO token itself —
   * HyperBEAM's own response carries no denomination for anything else
   * (see `ao/balance.ts`). When this lookup can't confirm a denomination
   * (metadata unresolved, or resolved with no `denomination` tag), the row
   * is marked `available: false` rather than rendered scaled by AO's
   * guess, which could be off by orders of magnitude for a token with a
   * different denomination.
   *
   * Cached by process id in `local:tokenMetadata:{processId}` with no
   * expiry: spawn tags are immutable once a process exists (see
   * `TokenMetadata`'s own doc comment), so a resolved result never goes
   * stale. This is what stops `resolveUnregisteredTokenMetadata` from
   * hitting the gateway on every `getTokenBalances` call for the same
   * watched token. A lookup failure is never cached — the next call gets
   * another chance to resolve it.
   *
   * A metadata lookup failure (`resolveUnregisteredTokenMetadata` returning
   * `null` — unreachable gateway, unspawned/unindexed process id) never
   * throws — one unresolvable token's identity shouldn't fail every other
   * token's balance read in the same `getTokenBalances` call. It instead
   * marks this one row unavailable (see above).
   */
  private async withUnregisteredMetadata(
    balance: TokenBalance,
    gatewayUrl: string,
  ): Promise<TokenBalance> {
    if (isRegisteredProcessId(balance.processId)) return balance;

    const metadata = await this.resolveTokenMetadataCached(balance.processId, gatewayUrl);
    if (metadata === null) return { ...balance, available: false };

    if (metadata.denomination === null) {
      // Ticker/name did resolve even though denomination didn't — still
      // applied below. `quantity` is kept as-is (it's a real atomic-unit
      // count from the HyperBEAM read); only the denomination needed to
      // scale it for display is unconfirmed, so `available: false` tells
      // callers not to trust a display formatted from it.
      return { ...balance, ticker: metadata.ticker ?? balance.ticker, name: metadata.name, available: false };
    }

    return {
      ...balance,
      ticker: metadata.ticker ?? balance.ticker,
      denomination: metadata.denomination,
      name: metadata.name,
    };
  }

  private async resolveTokenMetadataCached(
    processId: string,
    gatewayUrl: string,
  ): Promise<TokenMetadata | null> {
    const cacheKey = `${TOKEN_METADATA_KEY_PREFIX}${processId}`;
    const cached = await this.storage.get<unknown>(cacheKey);
    if (isValidTokenMetadata(cached)) return cached;

    const metadata = await resolveUnregisteredTokenMetadata(processId, gatewayUrl);
    if (metadata === null) return null;

    await this.storage.set(cacheKey, metadata);
    return metadata;
  }

  /**
   * Shared by `previewWatchedToken` and `addWatchedToken` so a preview and
   * the value actually stored can never disagree.
   */
  private async resolveTokenBalance(address: string, processId: string): Promise<TokenBalance> {
    const settings = await this.loadNetworkSettings();
    if (settings.activePeerUrl === null) {
      throw new Error(
        "No HyperBEAM peer configured. Add one in Network settings to read AO token balances.",
      );
    }

    const balance = await getTokenBalance(processId, address, settings.activePeerUrl);
    return this.withUnregisteredMetadata(withRegisteredTicker(balance), settings.gatewayUrl);
  }

  /**
   * Read-only resolve for the "paste a process id" add-token flow: proves
   * the id is a live token and returns its ticker/balance without storing
   * anything, so the popup can show a preview before the user confirms.
   */
  async previewWatchedToken(req: { address: string; processId: string }): Promise<TokenBalance> {
    const processId = req.processId.trim();
    if (processId.length === 0) {
      throw new Error("Enter a process id.");
    }
    return this.resolveTokenBalance(req.address, processId);
  }

  /**
   * Persists a previewed process id to the watch list. Re-resolves rather
   * than trusting a client-supplied balance, so a stale or forged preview
   * can't be stored as-is. No-op (but not an error) for an id that's
   * already watched, or for the default AO process id, which is always
   * shown without being in this list.
   */
  async addWatchedToken(req: { address: string; processId: string }): Promise<TokenBalance> {
    const processId = req.processId.trim();
    if (processId.length === 0) {
      throw new Error("Enter a process id.");
    }

    const resolved = await this.resolveTokenBalance(req.address, processId);

    if (processId !== DEFAULT_AO_PROCESS_ID) {
      const existing = await this.loadWatchedProcessIds(req.address);
      if (!existing.includes(processId)) {
        await this.storage.set(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, [...existing, processId]);
      }
    }

    return resolved;
  }

  /** The AO token counts as added: it is always listed without being stored. */
  async isTokenAdded(req: { address: string; processId: string }): Promise<boolean> {
    if (req.processId === DEFAULT_AO_PROCESS_ID) return true;
    return (await this.loadWatchedProcessIds(req.address)).includes(req.processId);
  }

  async removeWatchedToken(req: { address: string; processId: string }): Promise<void> {
    const existing = await this.loadWatchedProcessIds(req.address);
    const next = existing.filter((id) => id !== req.processId);
    if (next.length === existing.length) return;
    await this.storage.set(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, next);
  }

  async getBalance(req: { address: string }): Promise<Winston> {
    const settings = await this.loadNetworkSettings();
    return getArBalance(req.address, settings.gatewayUrl);
  }

  async getTokenBalances(req: { address: string }): Promise<TokenBalance[]> {
    const settings = await this.loadNetworkSettings();
    const watchedProcessIds = await this.loadWatchedProcessIds(req.address);
    const processIds = watchedProcessIds.includes(DEFAULT_AO_PROCESS_ID)
      ? watchedProcessIds
      : [DEFAULT_AO_PROCESS_ID, ...watchedProcessIds];

    if (processIds.length === 0) return [];

    if (settings.activePeerUrl === null) {
      throw new Error(
        "No HyperBEAM peer configured. Add one in Network settings to read AO token balances.",
      );
    }

    const activePeerUrl = settings.activePeerUrl;
    const settled = await Promise.allSettled(
      processIds.map((processId) => getTokenBalance(processId, req.address, activePeerUrl)),
    );
    const balances = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : unavailableTokenBalance(processIds[index] as string, req.address),
    );
    const withTickers = balances.map((balance) => withRegisteredTicker(balance));
    return Promise.all(
      withTickers.map((balance) =>
        balance.available === false ? balance : this.withUnregisteredMetadata(balance, settings.gatewayUrl),
      ),
    );
  }

  /**
   * `ProtocolMap`'s per-token balance read (`window.arweaveWallet`'s
   * `tokenBalance(id)`, Wander-shaped) — resolves a single AO process's
   * balance for the given wallet address via the same HyperBEAM
   * `~process@1.0` path `getTokenBalances` uses, rather than fetching every
   * watched token and filtering, since only one process id was asked for.
   * Read-only: no signing-approval window needed (`provider-bridge` only
   * needs to gate this behind a connection-approval Grant check).
   *
   * Same "no HyperBEAM peer configured" failure mode as
   * `getTokenBalances` — a balance this handler can't compute is a thrown,
   * named error, never a fabricated `"0"`.
   */
  async tokenBalance(
    req: { address: string } & TokenBalanceRequest,
  ): Promise<TokenBalanceResult> {
    const settings = await this.loadNetworkSettings();
    if (settings.activePeerUrl === null) {
      throw new Error(
        "No HyperBEAM peer configured. Add one in Network settings to read AO token balances.",
      );
    }

    const balance = await getTokenBalance(req.id, req.address, settings.activePeerUrl);
    return balance.quantity;
  }

  /**
   * `window.arweaveWallet.userTokens(options?)`, in Wander's shape. Reads
   * the same token list as `getTokenBalances`, then reshapes each entry.
   * `getTokenBalance` falls back to the process id as the ticker when it
   * finds none, so that fallback is dropped rather than passed off as a
   * ticker. A row the popup would show as unavailable reports a `null`
   * balance: its quantity may be a placeholder. `Denomination` is left out
   * entirely for such a row rather than sending its placeholder/guessed
   * value, since a dApp scaling a raw quantity by an unconfirmed
   * denomination could be off by orders of magnitude.
   */
  async userTokens(req: { address: string; options?: UserTokensOptions }): Promise<UserTokensResult> {
    const balances = await this.getTokenBalances({ address: req.address });
    const fetchBalance = req.options?.fetchBalance === true;

    return balances.map((balance): UserToken => {
      const token: UserToken = { processId: balance.processId };
      if (balance.available !== false) token.Denomination = balance.denomination;
      if (balance.name !== null) token.Name = balance.name;
      if (balance.ticker !== balance.processId) token.Ticker = balance.ticker;
      if (fetchBalance) token.balance = balance.available === false ? null : balance.quantity;
      return token;
    });
  }

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only — no deeper pagination cursor is implemented yet.
    const settings = await this.loadNetworkSettings();
    const [localLog, arEntries, aoEntries] = await Promise.all([
      this.loadActivityLog(req.address),
      queryActivityTransactions(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
      queryAoTransferActivity(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
    ]);

    return mergeActivity(localLog, [...arEntries, ...aoEntries], ACTIVITY_PAGE_LIMIT);
  }

  /**
   * Background pending→confirmed promotion check
   * (`registerActivityPromotionAlarm` below): re-runs `getActivity` for
   * every address with a locally-pending entry and persists the result
   * back into the per-address activity log, so a pending entry the
   * gateway has since indexed is written back as confirmed even with no
   * popup open to trigger a read. Reuses `getActivity`'s existing
   * `mergeActivity`-based promotion logic rather than duplicating it —
   * this method only adds "run it on a timer and persist the outcome."
   *
   * Only entries `mergeActivity` actually resolved as no-longer-pending
   * are written back (a local entry `mergeActivity` still reports
   * `"pending"` is left as-is, since the gateway hasn't caught up to it
   * yet) — this never overwrites a still-genuinely-pending entry, and
   * never removes a local entry the gateway hasn't indexed at all.
   */
  async promotePendingActivity(address: string): Promise<void> {
    const storedLog = await this.loadActivityLog(address);
    if (!storedLog.some((entry) => entry.status === "pending")) return;

    const localLog = await this.resolvePendingAoTransfers(address, storedLog);
    if (!localLog.some((entry) => entry.status === "pending")) return;

    const page = await this.getActivity({ address });
    const promoted = page.entries.filter((entry) => entry.status !== "pending");
    const promotedIds = new Set(promoted.map((entry) => entry.txId));

    const nextLog = localLog.map((entry) => {
      if (!promotedIds.has(entry.txId)) return entry;
      return promoted.find((candidate) => candidate.txId === entry.txId) ?? entry;
    });

    await this.storage.set(`${ACTIVITY_LOG_KEY_PREFIX}${address}`, nextLog);
  }

  /**
   * Settles pending AO sends from the token process's own evaluated result
   * (`core/ao/result.ts`) rather than the gateway index, which marks an
   * indexed AO message `"confirmed"` even when the process rejected the
   * transfer. Entries the CU hasn't evaluated yet stay pending for the
   * next tick. A `"failed"` outcome's reason is persisted on the entry's
   * `error` field for the activity row to show. Persists and returns the
   * updated log.
   */
  private async resolvePendingAoTransfers(address: string, localLog: ActivityEntry[]): Promise<ActivityEntry[]> {
    let changed = false;
    const resolved = await Promise.all(
      localLog.map(async (entry) => {
        if (entry.status !== "pending" || !entry.token) return entry;
        const outcome = await getTransferOutcome(entry.txId, entry.token);
        if (outcome.status === "pending") return entry;
        changed = true;
        return {
          ...entry,
          status: outcome.status,
          error: outcome.status === "failed" ? outcome.error : entry.error,
        };
      }),
    );

    if (changed) await this.storage.set(`${ACTIVITY_LOG_KEY_PREFIX}${address}`, resolved);
    return resolved;
  }

  /**
   * Every address currently holding at least one local activity-log entry
   * — the set `promotePendingActivity` needs to check on each alarm tick.
   * `local:activityLog:{address}` keys have no separate index anywhere
   * (each is written directly by `handlers/transfer.ts`), so this derives
   * the address set from the one place this handler already knows
   * addresses live: the wallets list.
   */
  async loadTrackedAddresses(): Promise<string[]> {
    const rawWallets = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(rawWallets) ? (rawWallets as Wallet[]) : [];
    return wallets.map((wallet) => wallet.address).filter((address): address is string => typeof address === "string");
  }

  /**
   * Resolves the active wallet's plaintext `address` directly from
   * storage — see this file's doc comment for why `getPortfolioHistory`
   * needs this and can't just take an `{ address }` request like every
   * other read here. Returns `null` when there's no active wallet yet
   * (matches `getState`'s own "no wallets" possibility) rather than
   * throwing, since an empty/unresolvable portfolio is itself a valid,
   * reportable state for the caller to handle.
   */
  private async resolveActiveWalletAddress(): Promise<string | null> {
    const rawWallets = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(rawWallets) ? (rawWallets as Wallet[]) : [];
    if (wallets.length === 0) return null;

    const activeWalletId = await this.storage.get<string | null>(ACTIVE_WALLET_ID_KEY);
    const active = wallets.find((wallet) => wallet.id === activeWalletId) ?? wallets[0];
    return active?.address ?? null;
  }

  /** De-duplicated so the same address imported twice isn't counted twice in the all-wallets total. */
  private async resolvePortfolioAddresses(scope: PortfolioScope): Promise<string[]> {
    if (scope === "all") return [...new Set(await this.loadTrackedAddresses())];
    const address = await this.resolveActiveWalletAddress();
    return address === null ? [] : [address];
  }

  /**
   * Drives the main screen's total-portfolio-value chart
   * (`ProtocolMap.getPortfolioHistory`). Sources each registered token's
   * (see `core/pricing`'s `DEFAULT_TOKEN_REGISTRY`) historical USD price
   * series via `getHistoricalUsdPrices` (the Gleam server's price proxy) and reduces them through
   * `estimateHistoricalPortfolioValue` at each AR series timestamp against
   * the *current* balance of that token, either the active wallet's or,
   * with `scope: "all"`, the sum across every stored wallet — this project models
   * only a current/latest-known balance, not reconstructed historical
   * balances (`estimateHistoricalPortfolioValue`'s own doc comment states
   * this is out of scope), so the chart shows how today's holdings would
   * have been valued over time, not a true historical balance curve.
   *
   * Only tokens in `DEFAULT_TOKEN_REGISTRY` (AR, AO) are priced — any other
   * watched AO token has no confirmed CoinGecko/CoinPaprika listing, so
   * it's left out of this estimate rather than guessed at (same HONESTY
   * contract as `priceSourceForProcessId`). AR's price series is the
   * timeline the chart is drawn against; if AO's own series fetch fails
   * independently, AO is silently left out of that run's total rather than
   * failing the whole chart — a temporary provider hiccup for one token
   * shouldn't blank the entire portfolio value.
   *
   * An unrecognized `range` throws a named error (never silently falls
   * back to a different range than the one requested). An empty AR price
   * series (both sources unavailable) reports `series: []` per
   * `PortfolioHistory`'s own contract — the popup shows
   * `NetworkErrorBanner` for that case rather than this handler
   * fabricating a flat line.
   */
  async getPortfolioHistory(req: { range: PortfolioHistoryRange; scope?: PortfolioScope }): Promise<PortfolioHistory> {
    if (!PORTFOLIO_HISTORY_RANGES.includes(req.range)) {
      throw new Error(`Unrecognized portfolio history range "${String(req.range)}".`);
    }

    const periodLabel = periodLabelForRange(req.range);
    const addresses = await this.resolvePortfolioAddresses(req.scope ?? "wallet");

    if (addresses.length === 0) {
      return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
    }

    const settings = await this.loadNetworkSettings();
    const arBalancesWinston = await Promise.all(addresses.map((address) => getArBalance(address, settings.gatewayUrl)));
    const arBalanceWinston = arBalancesWinston.reduce((sum, winston) => sum + BigInt(winston), 0n);
    const arBalance = Number(arBalanceWinston) / WINSTON_PER_AR;

    const arPriceSeries = AR_TOKEN.priceSource
      ? await getHistoricalUsdPrices(AR_TOKEN.priceSource, req.range, this.pricesApiUrl)
      : [];

    if (arPriceSeries.length === 0) {
      return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
    }

    const tokens = [{ balance: arBalance, priceAt: buildPriceAtFromSeries(arPriceSeries) }];

    if (AO_TOKEN.priceSource && settings.activePeerUrl !== null) {
      const peerUrl = settings.activePeerUrl;
      // A failed read leaves that wallet's AO out rather than failing the
      // whole chart whenever a peer hiccups — there's no way to tell whether
      // the wallet even holds AO.
      const aoQuantities = await Promise.all(
        addresses.map(async (address) => {
          try {
            const aoBalance = await getTokenBalance(AO_TOKEN.processId as string, address, peerUrl);
            return Number(aoBalance.quantity) / 10 ** aoBalance.denomination;
          } catch {
            return null;
          }
        }),
      );
      const readQuantities = aoQuantities.filter((quantity): quantity is number => quantity !== null);

      if (readQuantities.length > 0) {
        const aoQuantity = readQuantities.reduce((sum, quantity) => sum + quantity, 0);
        const aoPriceSeries = await getHistoricalUsdPrices(AO_TOKEN.priceSource, req.range, this.pricesApiUrl);
        if (aoPriceSeries.length > 0) {
          tokens.push({ balance: aoQuantity, priceAt: buildPriceAtFromSeries(aoPriceSeries) });
        } else if (aoQuantity > 0) {
          // A held AO balance with no price series would silently drop out of
          // the total, so an AO-only portfolio would chart as $0. Reported as
          // a failed range instead, like AR's own empty-series case.
          return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
        }
      }
    }

    const series = arPriceSeries.map((point) => ({
      timestamp: point.timestamp,
      usdValue: estimateHistoricalPortfolioValue(tokens, point.timestamp),
    }));

    const firstValue = series[0]?.usdValue ?? 0;
    const currentUsdValue = series[series.length - 1]?.usdValue ?? 0;
    const usdChange = firstValue !== 0 ? (currentUsdValue - firstValue) / firstValue : 0;

    return { range: req.range, series, currentUsdValue, usdChange, periodLabel };
  }

  /**
   * Current spot USD price for every token in `DEFAULT_TOKEN_REGISTRY`
   * (`ProtocolMap.getTokenPrices`) — drives each `TokenRow`'s per-row `$`
   * value. A token whose price sources both fail comes back with
   * `usd: null` (never a fabricated `0`); a token with no `priceSource`
   * at all (nothing outside the registry today) is skipped entirely
   * rather than returning a meaningless entry.
   */
  async getTokenPrices(): Promise<TokenPrice[]> {
    const priced = DEFAULT_TOKEN_REGISTRY.filter((token) => token.priceSource !== null);
    return Promise.all(
      priced.map(async (token) => ({
        processId: token.processId,
        usd: await getUsdPrice(token.priceSource as NonNullable<typeof token.priceSource>, this.pricesApiUrl),
      })),
    );
  }
}

/**
 * Name of the `chrome.alarms` alarm this module registers — namespaced
 * with the extension's own prefix convention (matches
 * `key-session.ts`/`wallet-lifecycle.ts`'s storage-key prefixes) so it
 * can't collide with an alarm another handler might register later.
 */
export const ACTIVITY_PROMOTION_ALARM_NAME = "gleam:activityPromotion";

/**
 * Every minute — frequent enough that a pending send/receive promotes to
 * confirmed within about the same window a user re-opening the popup
 * would already observe it (`getActivity` is called fresh on every popup
 * open), infrequent enough not to hammer the configured gateway on a
 * wallet with no pending activity (`promotePendingActivity` itself
 * short-circuits to a single storage read and no network call when there's
 * nothing pending, so most ticks cost nothing per tracked address anyway).
 * A tighter or looser interval is trivial to change here as a single
 * constant.
 */
const ACTIVITY_PROMOTION_INTERVAL_MINUTES = 1;

/**
 * Registers the `chrome.alarms`-based interval that actively promotes a
 * locally-pending activity entry to confirmed once the gateway indexes
 * it — independent of any popup being open. Only the alarm registration
 * and the `chrome.alarms.onAlarm` wiring live here (both are `chrome.*`
 * APIs, which `apps/extension/**` is allowed to use, unlike
 * `packages/core`, which must stay pure); all the actual
 * promotion/merge logic is `ReadsHandler.promotePendingActivity`, reusing
 * the existing `mergeActivity`-backed `getActivity` path rather than
 * duplicating it.
 *
 * Call once from the background entrypoint with a `ReadsHandler`
 * instance, e.g.: `registerActivityPromotionAlarm(new
 * ReadsHandler(storage))`. Errors from an individual address's promotion
 * check are caught and logged per-address so one failing gateway/address
 * never blocks promotion for the wallet's other tracked addresses on the
 * same tick.
 */
export function registerActivityPromotionAlarm(handler: ReadsHandler): void {
  browser.alarms.create(ACTIVITY_PROMOTION_ALARM_NAME, {
    periodInMinutes: ACTIVITY_PROMOTION_INTERVAL_MINUTES,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ACTIVITY_PROMOTION_ALARM_NAME) return;
    void runActivityPromotionTick(handler);
  });
}

async function runActivityPromotionTick(handler: ReadsHandler): Promise<void> {
  const addresses = await handler.loadTrackedAddresses();
  await Promise.all(
    addresses.map(async (address) => {
      try {
        await handler.promotePendingActivity(address);
      } catch (error) {
        console.error(`Activity promotion check failed for "${address}":`, error);
      }
    }),
  );
}
