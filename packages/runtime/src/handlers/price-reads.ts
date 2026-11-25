import {
  AO_TOKEN,
  AR_TOKEN,
  DEFAULT_TOKEN_REGISTRY,
  buildPriceAtFromSeries,
  seriesChange,
  estimateHistoricalPortfolioValue,
  getHistoricalUsdPrices,
  getUsdFxRate,
  getUsdPrice,
  changeSinceYesterday,
  isRegisteredProcessId,
  parsePriceSnapshots,
  readBestAsk,
  recordPriceSample,
} from "@gleam/core/src/pricing/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { isFiatCurrency, isArweaveId } from "@gleam/core";
import type {
  DisplayCurrency,
  NetworkSettings,
  PortfolioHistory,
  PortfolioHistoryRange,
  PortfolioScope,
  StoragePort,
  TokenPrice,
  TokenPriceHistory,
} from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { loadWallets } from "../stored-data";
import { ACTIVE_WALLET_ID_KEY } from "../storage-keys";
import { updateStored } from "../storage-update";
import { dappError } from "../dapp-error";
import { AO_TOKEN_METADATA, DEFAULT_AO_PROCESS_ID, readBalance } from "./token-reads";

const PRICE_SNAPSHOTS_KEY = "local:priceSnapshots";
/** More than a wallet lists is not a real request, and each id costs the node several reads. */
const MAX_PRICED_PROCESS_IDS = 50;
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

/** Prices and the portfolio chart; `pricesApiUrl` is the Gleam server, which proxies the price sources. */
export class PriceReads {
  constructor(
    private readonly storage: StoragePort,
    private readonly pricesApiUrl: string,
    private readonly loadSettings: () => Promise<NetworkSettings>,
    private readonly loadTrackedAddresses: () => Promise<string[]>,
  ) {}

  /**
   * Resolves the active wallet's plaintext `address` directly from
   * storage — see `ReadsHandler`'s doc comment (`handlers/reads.ts`) for why `getPortfolioHistory`
   * needs this and can't just take an `{ address }` request like every
   * other read here. Returns `null` when there's no active wallet yet
   * (matches `getState`'s own "no wallets" possibility) rather than
   * throwing, since an empty/unresolvable portfolio is itself a valid,
   * reportable state for the caller to handle.
   */
  private async resolveActiveWalletAddress(): Promise<string | null> {
    const wallets = await loadWallets(this.storage);
    if (wallets.length === 0) return null;

    const activeWalletId = await this.storage.get<string | null>(ACTIVE_WALLET_ID_KEY);
    const active = wallets.find((wallet) => wallet.id === activeWalletId) ?? wallets[0];
    return active?.address ?? null;
  }

  /** De-duplicated so the same address imported twice isn't counted twice in the all-wallets total. */
  private async resolvePortfolioAddresses(scope: PortfolioScope, requested: string | undefined): Promise<string[]> {
    if (requested !== undefined && !(await this.loadTrackedAddresses()).includes(requested)) {
      throw new Error(userErrorMessage("walletNotInGleam"));
    }
    if (scope === "all") return [...new Set(await this.loadTrackedAddresses())];
    const address = requested ?? (await this.resolveActiveWalletAddress());
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
   * The USD series is then converted to `currency`: a fiat currency at
   * today's exchange rate, AR or AO at that token's price at each point,
   * so a chart in AR shows what the holdings were worth in AR at the time.
   *
   * An unrecognized `range` throws a named error (never silently falls
   * back to a different range than the one requested). An empty AR price
   * series (both sources unavailable), or a currency that can't be priced,
   * reports `series: []` per `PortfolioHistory`'s own contract — the popup
   * shows `NetworkErrorBanner` for that case rather than this handler
   * fabricating a flat line.
   */
  async getPortfolioHistory(req: {
    range: PortfolioHistoryRange;
    address?: string;
    scope?: PortfolioScope;
    currency?: DisplayCurrency;
  }): Promise<PortfolioHistory> {
    if (!PORTFOLIO_HISTORY_RANGES.includes(req.range)) {
      throw new Error(dappError(`Unrecognized portfolio history range "${String(req.range)}".`));
    }

    const periodLabel = periodLabelForRange(req.range);
    const empty: PortfolioHistory = { range: req.range, series: [], currentValue: 0, change: 0, periodLabel };
    const currency = req.currency ?? "USD";
    const addresses = await this.resolvePortfolioAddresses(req.scope ?? "wallet", req.address);

    if (addresses.length === 0) return empty;

    const settings = await this.loadSettings();
    const historyOf = (source: typeof AR_TOKEN.priceSource) =>
      source ? getHistoricalUsdPrices(source, req.range, this.pricesApiUrl) : Promise.resolve([]);
    const spotOf = (source: typeof AR_TOKEN.priceSource) => (source ? getUsdPrice(source, this.pricesApiUrl) : Promise.resolve(null));
    const [arBalancesWinston, arPriceSeries, aoPriceSeries, aoQuantities, arSpot, aoSpot, fxRate] = await Promise.all([
      Promise.all(addresses.map((address) => getArBalance(address, settings.gatewayUrl))),
      historyOf(AR_TOKEN.priceSource),
      historyOf(AO_TOKEN.priceSource),
      // A failed read leaves that wallet's AO out rather than failing the
      // whole chart whenever a peer hiccups — there's no way to tell whether
      // the wallet even holds AO.
      Promise.all(
        (AO_TOKEN.priceSource ? addresses : []).map(async (address) => {
          try {
            const quantity = await readBalance(this.storage, settings, {
              processId: DEFAULT_AO_PROCESS_ID,
              address,
              transport: "mu",
            });
            return Number(quantity) / 10 ** (AO_TOKEN_METADATA.denomination ?? 12);
          } catch {
            return null;
          }
        }),
      ),
      spotOf(AR_TOKEN.priceSource),
      spotOf(AO_TOKEN.priceSource),
      isFiatCurrency(currency) ? getUsdFxRate(currency, this.pricesApiUrl) : Promise.resolve(null),
    ]);

    if (arPriceSeries.length === 0) return empty;

    const arBalanceWinston = arBalancesWinston.reduce((sum, winston) => sum + BigInt(winston), 0n);
    const arBalance = Number(arBalanceWinston) / WINSTON_PER_AR;
    const arPriceAt = buildPriceAtFromSeries(arPriceSeries);
    const tokens = [{ balance: arBalance, priceAt: arPriceAt, spot: arSpot }];
    const readQuantities = aoQuantities.filter((quantity): quantity is number => quantity !== null);
    if (readQuantities.length > 0) {
      const aoQuantity = readQuantities.reduce((sum, quantity) => sum + quantity, 0);
      if (aoPriceSeries.length > 0) {
        tokens.push({ balance: aoQuantity, priceAt: buildPriceAtFromSeries(aoPriceSeries), spot: aoSpot });
      } else if (aoQuantity > 0) {
        // A held AO balance with no price series would silently drop out of
        // the total, so an AO-only portfolio would chart as $0. Reported as
        // a failed range instead, like AR's own empty-series case.
        return empty;
      }
    }

    // The last historical point lags the spot price the token rows use, so
    // the headline total would drift from the rows' sum. The final point is
    // re-priced at spot, falling back to the series price when spot is down.
    const lastTimestamp = arPriceSeries[arPriceSeries.length - 1]?.timestamp ?? 0;
    const spotUsdValue = tokens.reduce((sum, token) => sum + token.balance * (token.spot ?? token.priceAt(lastTimestamp)), 0);
    const spotUnitUsd = (ticker: "AR" | "AO", fallback: number) => (ticker === "AR" ? arSpot : aoSpot) ?? fallback;

    let unitPriceAt: (timestamp: number) => number;
    if (currency === "AR") {
      unitPriceAt = arPriceAt;
    } else if (currency === "AO") {
      if (aoPriceSeries.length === 0) return empty;
      unitPriceAt = buildPriceAtFromSeries(aoPriceSeries);
    } else {
      if (fxRate === null) return empty;
      unitPriceAt = () => 1 / fxRate;
    }

    const series = arPriceSeries.map((point, index) => {
      const isLast = index === arPriceSeries.length - 1;
      let unitPrice = unitPriceAt(point.timestamp);
      if (isLast && (currency === "AR" || currency === "AO")) unitPrice = spotUnitUsd(currency, unitPrice);
      const usdValue = isLast ? spotUsdValue : estimateHistoricalPortfolioValue(tokens, point.timestamp);
      return { timestamp: point.timestamp, value: unitPrice > 0 ? usdValue / unitPrice : 0 };
    });

    const firstValue = series[0]?.value ?? 0;
    const currentValue = series[series.length - 1]?.value ?? 0;
    const change = firstValue !== 0 ? (currentValue - firstValue) / firstValue : 0;

    return { range: req.range, series, currentValue, change, periodLabel };
  }

  /**
   * Current spot price, in `currency`, for every token in
   * `DEFAULT_TOKEN_REGISTRY` (`ProtocolMap.getTokenPrices`) — drives each
   * `TokenRow`'s value line. A token whose price sources fail, or any
   * token when the currency itself can't be priced, comes back with
   * `price: null` (never a fabricated `0`).
   *
   * `processIds` adds tokens outside the registry, each priced from its own
   * orderbook (`readBestAsk`) at AR's price. Only an exact process id is
   * priced, never a ticker. One the node can't price is left out of the
   * result, not returned as `null`, so the caller shows no price for it.
   *
   * `change24h` comes from the same 24H series the chart uses. A fiat
   * display currency is treated as flat over the day; in AR or AO the move
   * is relative to that token, and the token itself has no move to show.
   * An orderbook token's move is against the device's own price samples.
   */
  async getTokenPrices(req: { currency?: DisplayCurrency; processIds?: string[] } = {}): Promise<TokenPrice[]> {
    const currency = req.currency ?? "USD";
    const priced = DEFAULT_TOKEN_REGISTRY.filter((token) => token.priceSource !== null);
    const [usdPrices, rate] = await Promise.all([
      Promise.all(
        priced.map(async (token) => {
          const source = token.priceSource as NonNullable<typeof token.priceSource>;
          const [usd, series] = await Promise.all([
            getUsdPrice(source, this.pricesApiUrl),
            getHistoricalUsdPrices(source, "24H", this.pricesApiUrl),
          ]);
          return { token, usd, change: seriesChange(series) };
        }),
      ),
      isFiatCurrency(currency) ? getUsdFxRate(currency, this.pricesApiUrl) : Promise.resolve(null),
    ]);

    const unitUsd = isFiatCurrency(currency)
      ? rate === null ? null : 1 / rate
      : (usdPrices.find(({ token }) => token.ticker === currency)?.usd ?? null);

    const unitChange = isFiatCurrency(currency) ? 0 : (usdPrices.find(({ token }) => token.ticker === currency)?.change ?? null);

    const registered = usdPrices.map(({ token, usd, change }) => ({
      processId: token.processId,
      price: usd === null || unitUsd === null || unitUsd <= 0 ? null : usd / unitUsd,
      change24h: change === null || unitChange === null || token.ticker === currency ? null : (1 + change) / (1 + unitChange) - 1,
    }));

    const arUsd = usdPrices.find(({ token }) => token.processId === null)?.usd ?? null;
    if (arUsd === null || unitUsd === null || unitUsd <= 0) return registered;

    const orderbook = await this.getOrderbookPrices(req.processIds ?? [], arUsd);
    return [
      ...registered,
      ...orderbook.map(({ processId, usd, change }) => ({
        processId,
        price: usd / unitUsd,
        change24h: change === null || unitChange === null ? null : (1 + change) / (1 + unitChange) - 1,
      })),
    ];
  }

  /**
   * One registered token's price over `range` in `currency`
   * (`ProtocolMap.getTokenPriceHistory`). Only `DEFAULT_TOKEN_REGISTRY`
   * tokens have a price listing to chart; an orderbook-priced token has no
   * history and gets `series: []`, as does a token shown in its own unit.
   *
   * In AR or AO each point is priced against that token at the same
   * moment. The last point is re-priced at spot so the chart ends on the
   * figure the Price row shows.
   */
  async getTokenPriceHistory(req: {
    processId: string | null;
    range: PortfolioHistoryRange;
    currency?: DisplayCurrency;
  }): Promise<TokenPriceHistory> {
    if (!PORTFOLIO_HISTORY_RANGES.includes(req.range)) {
      throw new Error(dappError(`Unrecognized price history range "${String(req.range)}".`));
    }
    const empty: TokenPriceHistory = { range: req.range, series: [] };
    const currency = req.currency ?? "USD";
    const token = DEFAULT_TOKEN_REGISTRY.find((candidate) => candidate.processId === req.processId);
    const source = token?.priceSource;
    if (!token || !source || token.ticker === currency) return empty;

    const unitSource = DEFAULT_TOKEN_REGISTRY.find((candidate) => candidate.ticker === currency)?.priceSource ?? null;

    const loadUnit = async () => {
      if (isFiatCurrency(currency)) {
        const rate = await getUsdFxRate(currency, this.pricesApiUrl);
        return rate === null ? null : { kind: "fiat" as const, rate };
      }
      if (unitSource === null) return null;
      const [series, spot] = await Promise.all([
        getHistoricalUsdPrices(unitSource, req.range, this.pricesApiUrl),
        getUsdPrice(unitSource, this.pricesApiUrl),
      ]);
      return series.length === 0 ? null : { kind: "token" as const, priceAt: buildPriceAtFromSeries(series), spot };
    };
    const [usdSeries, spotUsd, unit] = await Promise.all([
      getHistoricalUsdPrices(source, req.range, this.pricesApiUrl),
      getUsdPrice(source, this.pricesApiUrl),
      loadUnit(),
    ]);
    if (usdSeries.length === 0 || unit === null) return empty;

    const toCurrency = (usd: number, timestamp: number, isLast: boolean): number => {
      if (unit.kind === "fiat") return usd * unit.rate;
      const unitUsd = isLast && unit.spot !== null ? unit.spot : unit.priceAt(timestamp);
      return unitUsd > 0 ? usd / unitUsd : 0;
    };
    const series = usdSeries.map((point, index) => {
      const isLast = index === usdSeries.length - 1;
      const usd = isLast && spotUsd !== null ? spotUsd : point.usd;
      return { timestamp: point.timestamp, value: toCurrency(usd, point.timestamp, isLast) };
    });
    return { range: req.range, series };
  }

  /** USD price and 24h move of each token the node can price from its orderbook; the rest are absent. */
  private async getOrderbookPrices(
    requested: readonly string[],
    arUsd: number,
  ): Promise<{ processId: string; usd: number; change: number | null }[]> {
    const processIds = [...new Set(requested)]
      .filter((id) => isArweaveId(id) && !isRegisteredProcessId(id))
      .slice(0, MAX_PRICED_PROCESS_IDS);
    const nodeUrl = (await this.loadSettings()).activePeerUrl;
    if (processIds.length === 0 || nodeUrl === null) return [];

    const asks = await Promise.all(processIds.map(async (processId) => ({ processId, ask: await readBestAsk(processId, nodeUrl) })));
    const now = Date.now();
    let prices: { processId: string; usd: number; change: number | null }[] = [];
    await updateStored(this.storage, PRICE_SNAPSHOTS_KEY, (raw) => {
      const snapshots = parsePriceSnapshots(raw);
      prices = asks.flatMap(({ processId, ask }) => {
        if (ask === null) return [];
        const usd = ask.arPerToken * arUsd;
        if (!Number.isFinite(usd) || usd <= 0) return [];
        const samples = snapshots[processId] ?? [];
        snapshots[processId] = recordPriceSample(samples, usd, now);
        return [{ processId, usd, change: changeSinceYesterday(samples, usd, now) }];
      });
      return prices.length > 0 ? snapshots : undefined;
    });
    return prices;
  }
}
