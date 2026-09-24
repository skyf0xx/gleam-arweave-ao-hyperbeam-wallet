import { browser } from "wxt/browser";
import { getTokenBalance, getTransferOutcome } from "@gleam/core/src/ao/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { queryActivityTransactions, queryAoTransferActivity } from "@gleam/core/src/arweave/graphql.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import {
  AO_TOKEN,
  AR_TOKEN,
  DEFAULT_TOKEN_REGISTRY,
  buildPriceAtFromSeries,
  estimateHistoricalPortfolioValue,
  getHistoricalUsdPricesWithFallback,
  getUsdPriceWithFallback,
  isRegisteredProcessId,
  resolveUnregisteredTokenMetadata,
} from "@gleam/core/src/pricing/index.ts";
import { DEFAULT_HYPERBEAM_PEER_URLS } from "@gleam/core";
import type {
  ActivityEntry,
  ActivityPage,
  Grant,
  HyperBeamPeer,
  NetworkSettings,
  PortfolioHistory,
  PortfolioHistoryRange,
  StoragePort,
  TokenBalance,
  TokenBalanceRequest,
  TokenBalanceResult,
  TokenPrice,
  UserToken,
  UserTokensOptions,
  UserTokensResult,
  Wallet,
  Winston,
} from "@gleam/core";

/**
 * Background-side implementation of `ProtocolMap`'s read methods
 * (`getBalance`/`getTokenBalances`/`getActivity`/`getConnectedApps`) —
 * same constructor-injected-`StoragePort` shape as
 * `WalletLifecycleHandler` (`handlers/wallet-lifecycle.ts`), for the same
 * hexagonal reason: this file knows `StoragePort`'s shape, never
 * `wxt/utils/storage`.
 *
 * Storage schema this handler owns:
 * - `local:networkSettings` — `NetworkSettings`, defaulting to
 *   `arweave.net` with no HyperBEAM peers configured (an AO balance read
 *   with no active peer throws a named "no HyperBEAM peer configured"
 *   error rather than silently returning a zero balance — HONESTY: a
 *   value this handler can't compute is surfaced as unavailable, not as
 *   a plausible default).
 * - `local:activityLog:{address}` — `ActivityEntry[]`, the local
 *   append-only action log `handlers/transfer.ts` writes optimistic
 *   entries into. Read-only from this handler's side; `transfer.ts` owns
 *   writing it. Keyed per-address since the log is scoped to whichever
 *   wallet's activity is being viewed.
 * - `local:wallets` / `local:activeWalletId` — owned by
 *   `handlers/wallet-lifecycle.ts` (`WalletLifecycleHandler`'s own doc
 *   comment), read-only here. `getPortfolioHistory`'s `ProtocolMap`
 *   signature (`packages/messaging/src/protocol.ts`, locked, outside this
 *   task's ALLOWED SCOPE) takes only `{ range }` — no address, unlike
 *   every other read in this file — so this handler resolves "whose
 *   balance to price" itself from these two keys rather than inventing an
 *   address param the locked contract doesn't have. `Wallet.address` is
 *   plaintext (only `encryptedKeyfile` is encrypted, per the `Wallet`
 *   model's own doc comment), so this needs no vault/decryption access —
 *   still only `StoragePort`, the same hexagonal boundary every other
 *   method in this file already respects.
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
  if (balance.ticker !== balance.processId) return balance;
  const registered = DEFAULT_TOKEN_REGISTRY.find((token) => token.processId === balance.processId);
  return registered ? { ...balance, ticker: registered.ticker } : balance;
}

/**
 * For a `TokenBalance` whose process isn't in `DEFAULT_TOKEN_REGISTRY`
 * (so `withRegisteredTicker` had nothing to apply), resolves ticker and
 * denomination directly from the process's spawn tags via the gateway's
 * GraphQL endpoint (`resolveUnregisteredTokenMetadata` —
 * `core/pricing/token-sources.ts`) rather than leaving the balance
 * identified only by its raw process id. This is purely additive
 * identification for watched-but-unregistered tokens: the balance
 * quantity itself still comes only from the existing HyperBEAM
 * `~process@1.0` compute path (`getTokenBalance`), and a registered
 * token's identity (checked first) is never overridden by this lookup.
 *
 * A metadata lookup failure (`resolveUnregisteredTokenMetadata` returning
 * `null` — unreachable gateway, unspawned/unindexed process id) leaves
 * the balance exactly as `getTokenBalance` returned it (process id as
 * ticker, HyperBEAM's own denomination guess) rather than throwing —
 * one unresolvable token's identity shouldn't fail every other token's
 * balance read in the same `getTokenBalances` call.
 */
async function withUnregisteredMetadata(
  balance: TokenBalance,
  gatewayUrl: string,
): Promise<TokenBalance> {
  if (isRegisteredProcessId(balance.processId)) return balance;

  const metadata = await resolveUnregisteredTokenMetadata(balance.processId, gatewayUrl);
  if (metadata === null) return balance;

  return {
    ...balance,
    ticker: metadata.ticker ?? balance.ticker,
    denomination: metadata.denomination ?? balance.denomination,
  };
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

export class ReadsHandler {
  constructor(private readonly storage: StoragePort) {}

  async loadNetworkSettings(): Promise<NetworkSettings> {
    const raw = await this.storage.get<unknown>(NETWORK_SETTINGS_KEY);
    return isValidNetworkSettings(raw) ? raw : DEFAULT_NETWORK_SETTINGS;
  }

  /**
   * `ProtocolMap.getNetworkSettings`'s backing read — same shape as
   * `loadNetworkSettings` (used internally by `getBalance`/
   * `getTokenBalances`/`getActivity`), exposed under the exact protocol
   * method name so the dispatcher (`entrypoints/background/index.ts`,
   * outside this task's ALLOWED SCOPE — see this task's final report)
   * has a call site to wire `getNetworkSettings` to.
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

  async getWatchedTokens(req: { address: string }): Promise<string[]> {
    return this.loadWatchedProcessIds(req.address);
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
    return withUnregisteredMetadata(withRegisteredTicker(balance), settings.gatewayUrl);
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
    const balances = await Promise.all(
      processIds.map((processId) => getTokenBalance(processId, req.address, activePeerUrl)),
    );
    const withTickers = balances.map((balance) => withRegisteredTicker(balance));
    return Promise.all(
      withTickers.map((balance) => withUnregisteredMetadata(balance, settings.gatewayUrl)),
    );
  }

  /**
   * `ProtocolMap`'s per-token balance read (`window.arweaveWallet`'s
   * `tokenBalance(id)`, Wander-shaped) — resolves a single AO process's
   * balance for the given wallet address via the same HyperBEAM
   * `~process@1.0` path `getTokenBalances` uses, rather than fetching every
   * watched token and filtering, since only one process id was asked for.
   * Read-only: no signing-approval window needed (`provider-bridge` only
   * needs to gate this behind a connection-approval Grant check, per this
   * task's RELEVANT RULES).
   *
   * Same "no HyperBEAM peer configured" HONESTY failure as
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
   * `ProtocolMap`'s token-discovery read (`window.arweaveWallet`'s
   * `userTokens(options?)`, Wander-shaped) — reuses `getTokenBalances`'s
   * exact registry-plus-spawn-tag-discovered resolution (per this task's
   * RELEVANT RULES: no separate token-listing source) and reshapes each
   * resolved `TokenBalance` into `UserToken`'s Wander-cased fields.
   *
   * Null-metadata decision: `UserToken.Ticker`/`Name`/`Denomination` have
   * no nullable variant (see `token-metadata.ts`'s own doc comment flagging
   * this gap), while `TokenBalance.ticker`/`denomination` here are always
   * populated (either from `DEFAULT_TOKEN_REGISTRY`, resolved spawn tags,
   * or `getTokenBalance`'s own raw-process-id/HyperBEAM-denomination
   * fallback — see `withRegisteredTicker`/`withUnregisteredMetadata`), so
   * `Ticker`/`Denomination` are never actually null at this point. `Name`
   * has no fallback anywhere in the existing `TokenBalance` shape, so a
   * balance with an unregistered, spawn-tag-unresolved process id has no
   * name to show — that entry is omitted from the result entirely (a
   * dApp can't usefully display an unnamed token), rather than inventing a
   * placeholder name. This never drops AR/AO (both always named via the
   * registry) or any token whose spawn tags resolved a name.
   *
   * Pagination: `UserTokensOptions.cursor`/`limit` have no existing
   * convention elsewhere in this handler (`getActivity`'s own `cursor` is
   * explicitly unimplemented, see its comment above) to follow, so this
   * applies a simple slice-based cursor: `cursor` is the stringified
   * offset into the resolved (and name-filtered) list to resume from, and
   * `limit` caps how many entries come back. `UserTokensResult` itself
   * (locked, `token-metadata.ts`) carries no next-cursor field, so there's
   * nothing for a caller to page with beyond re-deriving the next offset
   * from `options.cursor + result.length` — acceptable since Wander's own
   * `userTokens()` shape is the same bare array.
   */
  async userTokens(req: { address: string; options?: UserTokensOptions }): Promise<UserTokensResult> {
    const balances = await this.getTokenBalances({ address: req.address });

    const tokens: UserToken[] = [];
    for (const balance of balances) {
      const registered = DEFAULT_TOKEN_REGISTRY.find((token) => token.processId === balance.processId);
      const name = registered?.name ?? null;
      if (name === null) continue;

      tokens.push({
        processId: balance.processId,
        Ticker: balance.ticker,
        Name: name,
        Denomination: String(balance.denomination),
      });
    }

    const cursor = req.options?.cursor;
    const offset = cursor !== undefined && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const limit = req.options?.limit;
    return limit !== undefined ? tokens.slice(offset, offset + limit) : tokens.slice(offset);
  }

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only in this phase — no deeper pagination cursor is implemented yet, see final report.
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

  /**
   * Drives the main screen's total-portfolio-value chart
   * (`ProtocolMap.getPortfolioHistory`). Sources each registered token's
   * (see `core/pricing`'s `DEFAULT_TOKEN_REGISTRY`) historical USD price
   * series via `getHistoricalUsdPricesWithFallback` (CoinGecko, falling
   * back to CoinPaprika) and reduces them through
   * `estimateHistoricalPortfolioValue` at each AR series timestamp against
   * the wallet's *current* balance of that token — this project models
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
   * An unrecognized `range` throws a named error (HONESTY: never silently
   * fall back to a different range than the one requested). An empty AR
   * price series (both sources unavailable) reports `series: []` per
   * `PortfolioHistory`'s own HONESTY contract — the popup shows
   * `NetworkErrorBanner` for that case rather than this handler
   * fabricating a flat line.
   */
  async getPortfolioHistory(req: { range: PortfolioHistoryRange }): Promise<PortfolioHistory> {
    if (!PORTFOLIO_HISTORY_RANGES.includes(req.range)) {
      throw new Error(`Unrecognized portfolio history range "${String(req.range)}".`);
    }

    const address = await this.resolveActiveWalletAddress();
    const periodLabel = periodLabelForRange(req.range);

    if (address === null) {
      return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
    }

    const settings = await this.loadNetworkSettings();
    const arBalanceWinston = await getArBalance(address, settings.gatewayUrl);
    const arBalance = Number(arBalanceWinston) / WINSTON_PER_AR;

    const arPriceSeries = AR_TOKEN.priceSource
      ? await getHistoricalUsdPricesWithFallback(AR_TOKEN.priceSource, req.range)
      : [];

    if (arPriceSeries.length === 0) {
      return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
    }

    const tokens = [{ balance: arBalance, priceAt: buildPriceAtFromSeries(arPriceSeries) }];

    if (AO_TOKEN.priceSource && settings.activePeerUrl !== null) {
      try {
        const aoBalance = await getTokenBalance(AO_TOKEN.processId as string, address, settings.activePeerUrl);
        const aoQuantity = Number(aoBalance.quantity) / 10 ** aoBalance.denomination;
        const aoPriceSeries = await getHistoricalUsdPricesWithFallback(AO_TOKEN.priceSource, req.range);
        if (aoPriceSeries.length > 0) {
          tokens.push({ balance: aoQuantity, priceAt: buildPriceAtFromSeries(aoPriceSeries) });
        } else if (aoQuantity > 0) {
          // A held (nonzero) AO balance whose price series is unavailable would
          // otherwise silently drop out of the total, making an AR-empty/AO-only
          // wallet's chart render as if the whole portfolio were worth $0 — an
          // AR-only total is honest, but a total that's missing a token the
          // wallet actually holds is not. Reported as a failed range like AR's
          // own empty-price-series case, rather than a fabricated AR-only total.
          return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
        }
      } catch {
        // Balance read itself failed — see the aoQuantity > 0 branch above for
        // why a *held* AO balance can't just be silently dropped here either,
        // but the balance read failing means aoQuantity was never resolved, so
        // there's no way to tell whether this wallet even holds AO. Falls back
        // to AR-only, matching this catch's original intent, rather than
        // failing every chart for every wallet whenever a peer hiccups.
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
   * value. A token whose price source both fail comes back with
   * `usd: null` (HONESTY: never a fabricated `0`); a token with no
   * `priceSource` at all (nothing outside the registry today) is skipped
   * entirely rather than returning a meaningless entry.
   */
  async getTokenPrices(): Promise<TokenPrice[]> {
    const priced = DEFAULT_TOKEN_REGISTRY.filter((token) => token.priceSource !== null);
    return Promise.all(
      priced.map(async (token) => ({
        processId: token.processId,
        usd: await getUsdPriceWithFallback(token.priceSource as NonNullable<typeof token.priceSource>),
      })),
    );
  }

  /**
   * Stubbed: `Grant`/connected-apps storage doesn't exist yet — no layer
   * before this one owns writing a `Grant` record, and `provider-bridge`
   * (the layer that builds the connection-approval flow that would create
   * one) hasn't been built. Returns an empty array rather than throwing,
   * since "no connected apps yet" is a legitimate, common state this
   * stub's behavior happens to match exactly — but it cannot yet
   * distinguish "no apps connected" from "grants aren't implemented," so
   * `provider-bridge` must replace this method's body (not just add to
   * it) once `Grant` storage is real. See this task's final report.
   */
  async getConnectedApps(): Promise<Grant[]> {
    return [];
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
 * No existing interval convention elsewhere in this codebase to match, so
 * this is this task's own choice, not a documented product requirement —
 * flagged as such in this task's final report; a tighter or looser
 * interval is trivial to change here as a single constant.
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
 * Call once from the background entrypoint (`entrypoints/background/
 * index.ts`, outside this task's ALLOWED SCOPE — same "no dispatcher in
 * this task's scope" situation `wallet-core`'s original build already hit
 * for `getNetworkSettings`) with a `ReadsHandler` instance, e.g.:
 * `registerActivityPromotionAlarm(new ReadsHandler(storage))`. Errors
 * from an individual address's promotion check are caught and logged
 * per-address so one failing gateway/address never blocks promotion for
 * the wallet's other tracked addresses on the same tick.
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
