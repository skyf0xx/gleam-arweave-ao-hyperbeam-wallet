import { getTokenBalance } from "@gleam/core/src/ao/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { queryActivityTransactions } from "@gleam/core/src/arweave/graphql.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import {
  buildPriceAtFromSeries,
  estimateHistoricalPortfolioValue,
  getHistoricalUsdPricesWithFallback,
} from "@gleam/core/src/pricing/index.ts";
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
 * `getTokenBalances`'s AO process list: `TokenBalance` has no
 * "which processIds does this wallet hold" registry anywhere in `core`'s
 * models or this task's ALLOWED SCOPE — no layer owns a token-list/watch
 * list concept yet. This handler resolves that against
 * `local:watchedProcessIds:{address}` (a simple `string[]` this handler
 * also defaults to empty), which is the least-invented storage key that
 * makes `getTokenBalances` return something rather than nothing; see this
 * task's final report for why a real "add a token" flow isn't included
 * here (out of ALLOWED SCOPE — no popup screen for it was requested by
 * this packet either).
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
  peers: [],
  activePeerUrl: null,
};

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
    typeof candidate.timestamp === "number"
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

  async getBalance(req: { address: string }): Promise<Winston> {
    const settings = await this.loadNetworkSettings();
    return getArBalance(req.address, settings.gatewayUrl);
  }

  async getTokenBalances(req: { address: string }): Promise<TokenBalance[]> {
    const settings = await this.loadNetworkSettings();
    const processIds = await this.loadWatchedProcessIds(req.address);

    if (processIds.length === 0) return [];

    if (settings.activePeerUrl === null) {
      throw new Error(
        "No HyperBEAM peer configured. Add one in Network settings to read AO token balances.",
      );
    }

    const activePeerUrl = settings.activePeerUrl;
    return Promise.all(
      processIds.map((processId) => getTokenBalance(processId, req.address, activePeerUrl)),
    );
  }

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only in this phase — no deeper pagination cursor is implemented yet, see final report.
    const settings = await this.loadNetworkSettings();
    const [localLog, gatewayEntries] = await Promise.all([
      this.loadActivityLog(req.address),
      queryActivityTransactions(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
    ]);

    return mergeActivity(localLog, gatewayEntries, ACTIVITY_PAGE_LIMIT);
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
   * (`ProtocolMap.getPortfolioHistory`). Sources the AR historical USD
   * price series from `core/pricing`'s
   * `getHistoricalUsdPricesWithFallback` (CoinGecko, falling back to
   * CoinPaprika) and reduces it through `estimateHistoricalPortfolioValue`
   * at each series timestamp against the wallet's *current* AR balance —
   * this project models only a current/latest-known balance, not
   * reconstructed historical balances (`estimateHistoricalPortfolioValue`'s
   * own doc comment states this is out of scope), so the chart shows how
   * today's holdings would have been valued over time, not a true
   * historical balance curve.
   *
   * Phase 1 prices AR only — `TokenBalance`'s AO holdings have no
   * CoinGecko/CoinPaprika id mapping anywhere in this codebase yet (no
   * layer owns a ticker→price-source-id registry), so they're left out of
   * this estimate rather than guessed at.
   *
   * An unrecognized `range` throws a named error (HONESTY: never silently
   * fall back to a different range than the one requested). An empty
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

    const priceSeries = await getHistoricalUsdPricesWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      req.range,
    );

    if (priceSeries.length === 0) {
      return { range: req.range, series: [], currentUsdValue: 0, usdChange: 0, periodLabel };
    }

    const priceAt = buildPriceAtFromSeries(priceSeries);
    const tokens = [{ balance: arBalance, priceAt }];

    const series = priceSeries.map((point) => ({
      timestamp: point.timestamp,
      usdValue: estimateHistoricalPortfolioValue(tokens, point.timestamp),
    }));

    const firstValue = series[0]?.usdValue ?? 0;
    const currentUsdValue = series[series.length - 1]?.usdValue ?? 0;
    const usdChange = firstValue !== 0 ? (currentUsdValue - firstValue) / firstValue : 0;

    return { range: req.range, series, currentUsdValue, usdChange, periodLabel };
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
