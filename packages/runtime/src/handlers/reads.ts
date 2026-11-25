import { discoverTokens, type DiscoverTokensOptions } from "@gleam/core/src/ao/index.ts";
import { isRegisteredProcessId, impersonatesRegisteredToken } from "@gleam/core/src/pricing/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import { POINTS_API_URL, isArweaveId } from "@gleam/core";
import { updateStored } from "../storage-update";
import { mergeDiscoveredPeers, readDismissedPeers, readExtraPeerUrls } from "../peers";
import type {
  ActivityEntry,
  ActivityPage,
  Collectible,
  DisplayCurrency,
  NetworkSettings,
  PendingTransfer,
  PortfolioHistory,
  PortfolioHistoryRange,
  PortfolioScope,
  StoragePort,
  TokenBalance,
  TokenBalanceRequest,
  TokenBalanceResult,
  TokenMetadata,
  TokenPrice,
  TokenPriceHistory,
  TokenTransport,
  UserToken,
  UserTokensOptions,
  UserTokensResult,
  Winston,
} from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { loadActivityLog, loadNetworkSettings as loadStoredNetworkSettings } from "../stored-data";
import { WATCHED_PROCESS_IDS_KEY_PREFIX } from "../storage-keys";
import { stringList, withFallbackAfter } from "../guards";
import { ActivityReads } from "./activity-reads";
import { CollectiblesReads } from "./collectibles-reads";
import { PriceReads } from "./price-reads";
import {
  DEFAULT_AO_PROCESS_ID,
  DISCOVERED_TOKENS_KEY_PREFIX,
  HIDDEN_PROCESS_IDS_KEY_PREFIX,
  isDiscoveredTokensCache,
  loadHiddenProcessIds,
  loadTokenMetadata,
  loadWatchedProcessIds,
  readBalance,
  tokenRow,
  type DiscoveredTokensCache,
} from "./token-reads";

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
 *   `arweave.net` and the default HyperBEAM peer.
 * - `local:activityLog:{address}` — `ActivityEntry[]`, the local
 *   action log `handlers/transfer.ts` adds optimistic entries to and
 *   the settle below writes outcomes into, both through `updateStored`.
 *   Keyed per-address since the log is scoped to whichever wallet's
 *   activity is being viewed.
 * - `local:wallets` / `local:activeWalletId` — owned by
 *   `handlers/wallet-lifecycle.ts` (`WalletLifecycleHandler`'s own doc
 *   comment), read-only here. `getPortfolioHistory` prices the wallet
 *   whose `address` the caller names, refusing one that isn't stored,
 *   so a surface showing one wallet never gets another's chart after a
 *   switch elsewhere; without an `address` it falls back to the active
 *   wallet from these two keys. `Wallet.address` is plaintext (only
 *   `encryptedKeyfile` is encrypted, per the `Wallet` model's own doc
 *   comment), so this needs no vault/decryption access — still only
 *   `StoragePort`, the same hexagonal boundary every other method in
 *   this file already respects.
 *
 * Token lists, per address:
 * - `local:watchedProcessIds:{address}` — `string[]`, tokens added by
 *   hand. AO is always listed and never stored here.
 * - `local:hiddenProcessIds:{address}` — `string[]`, tokens the user
 *   removed, kept out of discovery's results.
 * - `local:discoveredTokens:{address}` — `{ savedAt, processIds }`, the
 *   last `core/ao/token-discovery.ts` result.
 * - `local:tokenMetadata:{processId}` — `TokenMetadata`, shared by every
 *   wallet. It carries the token's transport, which decides where its
 *   balance is read and how it is sent (`core/ao/balance.ts`'s
 *   `readTokenBalance`).
 */
// A received token should show up within a minute, and the wallet's own
// history is the only signal that one arrived. A popup open inside this
// window reuses the last result.
const DISCOVERED_TOKENS_TTL_MS = 60 * 1000;
// Long enough for the L1 scans on a slow gateway. Past it the balances
// return with the last list, and the next read has the new one.
const DISCOVERY_WAIT_MS = 8_000;

export class ReadsHandler {
  private readonly discoveryInFlight = new Map<string, Promise<string[]>>();
  private readonly collectibles: CollectiblesReads;
  private readonly activity: ActivityReads;
  private readonly prices: PriceReads;

  /**
   * `pricesApiUrl` is the Gleam server, which proxies CoinGecko/CoinPaprika
   * for users who can't reach them. `discover` finds a wallet's tokens.
   */
  constructor(
    private readonly storage: StoragePort,
    pricesApiUrl: string = POINTS_API_URL,
    private readonly discover: (options: DiscoverTokensOptions) => Promise<TokenMetadata[]> = discoverTokens,
  ) {
    const loadSettings = () => this.loadNetworkSettings();
    this.collectibles = new CollectiblesReads(storage, loadSettings);
    this.activity = new ActivityReads(storage, loadSettings, this.collectibles);
    this.prices = new PriceReads(storage, pricesApiUrl, loadSettings, () => this.loadTrackedAddresses());
  }

  /**
   * The stored settings with the community and discovered peers the user
   * hasn't removed appended. They're merged on every read, never written
   * back, so the stored settings stay exactly as the user saved them.
   */
  async loadNetworkSettings(): Promise<NetworkSettings> {
    return mergeDiscoveredPeers(
      await loadStoredNetworkSettings(this.storage),
      await readExtraPeerUrls(this.storage),
      await readDismissedPeers(this.storage),
    );
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
    return loadActivityLog(this.storage, address);
  }

  async loadWatchedProcessIds(address: string): Promise<string[]> {
    return loadWatchedProcessIds(this.storage, address);
  }

  getCollectibles(req: { address: string; refresh?: boolean }): Promise<Collectible[]> {
    return this.collectibles.get(req);
  }

  forgetCollectible(req: { address: string; id: string }): Promise<void> {
    return this.collectibles.forget(req);
  }

  setCachedNameTarget(req: { address: string; id: string; target: string }): Promise<void> {
    return this.collectibles.setCachedNameTarget(req);
  }

  async getWatchedTokens(req: { address: string }): Promise<string[]> {
    return this.loadWatchedProcessIds(req.address);
  }

  /**
   * Process ids found from the wallet's history (`core/ao/token-discovery.ts`),
   * cached per wallet for `DISCOVERED_TOKENS_TTL_MS`. Past that a read
   * waits for the refresh's first results, so a newly received token shows
   * on this read rather than the next one, but no longer than
   * `DISCOVERY_WAIT_MS`. A failed discovery leaves the cache as it was, and
   * a successful one adds to it.
   */
  private async discoveredProcessIds(address: string, settings: NetworkSettings): Promise<string[]> {
    const key = `${DISCOVERED_TOKENS_KEY_PREFIX}${address}`;
    const raw = await this.storage.get<unknown>(key);
    const cached = isDiscoveredTokensCache(raw) ? raw : null;
    if (cached && Date.now() - cached.savedAt < DISCOVERED_TOKENS_TTL_MS) return cached.processIds;

    // Keep what earlier runs found: each gateway scan can fail on its own and discovery still
    // returns, so a token missing from this run may just be behind a flaky scan. One the wallet
    // no longer holds drops out of the list on its zero balance. What it found isn't
    // cached as token details: those come from `loadTokenMetadata`, which checks the
    // decimals against other gateways first.
    const keep = async (found: TokenMetadata[]): Promise<string[]> =>
      [...new Set([...found.map((metadata) => metadata.processId), ...(cached?.processIds ?? [])])];

    let running = this.discoveryInFlight.get(address);
    if (!running) {
      let publishEarly: (processIds: string[]) => void = () => {};
      const early = new Promise<string[]>((resolve) => {
        publishEarly = resolve;
      });
      const done = (async () => {
        try {
          const found = await this.discover({
            address,
            gatewayUrl: settings.gatewayUrl,
            onL1Tokens: async (tokens) => {
              const processIds = await keep(tokens);
              // Not stamped as fresh: the Credit-Notice scan hasn't reported yet. A cache
              // fill; discoveryInFlight runs one discovery per wallet at a time.
              // eslint-disable-next-line gleam/no-storage-read-modify-write
              await this.storage.set<DiscoveredTokensCache>(key, { savedAt: cached?.savedAt ?? 0, processIds });
              publishEarly(processIds);
            },
          });
          const processIds = await keep(found);
          // eslint-disable-next-line gleam/no-storage-read-modify-write -- as above
          await this.storage.set<DiscoveredTokensCache>(key, { savedAt: Date.now(), processIds });
          return processIds;
        } catch (error) {
          console.warn(`Token discovery for "${address}" failed:`, error);
          return cached?.processIds ?? [];
        } finally {
          this.discoveryInFlight.delete(address);
        }
      })();
      running = Promise.race([early, done]);
      this.discoveryInFlight.set(address, running);
    }
    return withFallbackAfter(running, DISCOVERY_WAIT_MS, cached?.processIds ?? []);
  }

  /**
   * Read-only resolve for the "paste a process id" add-token flow: proves
   * the id is a token and returns its ticker and balance without storing
   * anything. A token whose balance can't be read right now still
   * previews (as unavailable, with the reason) and can still be added;
   * only an id that isn't a token is refused.
   */
  async previewWatchedToken(req: { address: string; processId: string }): Promise<TokenBalance> {
    const processId = req.processId.trim();
    if (processId.length === 0) throw new Error(userErrorMessage("tokenPasteId"));
    if (!isArweaveId(processId)) {
      throw new Error(
        userErrorMessage("tokenBadId"),
      );
    }
    if (processId === req.address) throw new Error(userErrorMessage("tokenIsOwnAddress"));
    const settings = await this.loadNetworkSettings();
    const metadata = await loadTokenMetadata(this.storage, processId, settings);
    if (metadata.assetClass === "unique") {
      throw new Error(userErrorMessage("tokenIsCollectible"));
    }
    if (metadata.ticker === null && metadata.name === null) {
      throw new Error(userErrorMessage("tokenNoIdentity"));
    }
    return tokenRow(this.storage, req.address, processId, settings, "watched");
  }

  /**
   * Persists a previewed process id to the watch list, and un-hides it.
   * Re-resolves rather than trusting a client-supplied preview. No-op
   * (but not an error) for an id that's already watched, or for the
   * default AO process id, which is always shown without being stored.
   *
   * Refuses a process whose ticker or name presents itself as a
   * registered token, unless it is that registered token: the same
   * impersonation filter `getTokenBalances` applies to discovered
   * tokens. Both add paths — a dApp's `addToken` approval and the
   * manual paste-a-process-id flow — funnel through here, so the one
   * check covers both.
   */
  async addWatchedToken(req: { address: string; processId: string }): Promise<TokenBalance> {
    const resolved = await this.previewWatchedToken(req);
    const processId = resolved.processId;

    if (
      !isRegisteredProcessId(processId) &&
      impersonatesRegisteredToken({ ticker: resolved.ticker, name: resolved.name })
    ) {
      throw new Error(userErrorMessage("tokenImpersonatesRegistered"));
    }

    if (processId !== DEFAULT_AO_PROCESS_ID) {
      await updateStored(this.storage, `${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, (raw) => {
        const existing = stringList(raw);
        return existing.includes(processId) ? undefined : [...existing, processId];
      });
    }
    await updateStored(this.storage, `${HIDDEN_PROCESS_IDS_KEY_PREFIX}${req.address}`, (raw) => {
      const hidden = stringList(raw);
      return hidden.includes(processId) ? hidden.filter((id) => id !== processId) : undefined;
    });
    return resolved;
  }

  /** The AO token counts as added: it is always listed without being stored. */
  async isTokenAdded(req: { address: string; processId: string }): Promise<boolean> {
    if (req.processId === DEFAULT_AO_PROCESS_ID) return true;
    return (await this.loadWatchedProcessIds(req.address)).includes(req.processId);
  }

  /**
   * Drops a token from the list, watched or discovered. It is also hidden,
   * so discovery doesn't bring it straight back; adding it again by id
   * un-hides it.
   */
  async removeWatchedToken(req: { address: string; processId: string }): Promise<void> {
    if (req.processId === DEFAULT_AO_PROCESS_ID) return;
    await updateStored(this.storage, `${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, (raw) => {
      const existing = stringList(raw);
      const next = existing.filter((id) => id !== req.processId);
      return next.length !== existing.length ? next : undefined;
    });
    await updateStored(this.storage, `${HIDDEN_PROCESS_IDS_KEY_PREFIX}${req.address}`, (raw) => {
      const hidden = stringList(raw);
      return hidden.includes(req.processId) ? undefined : [...hidden, req.processId];
    });
  }

  async getBalance(req: { address: string }): Promise<Winston> {
    const settings = await this.loadNetworkSettings();
    return getArBalance(req.address, settings.gatewayUrl);
  }

  /**
   * AO, then the watch list, then tokens discovered from the wallet's
   * history. Anyone can make a process that credits a wallet, so a
   * discovered token's ticker, name and balance are the stranger's
   * claims: it is listed only while it holds a readable, positive balance,
   * never when it presents itself as a registry token
   * (`impersonatesRegisteredToken`), and always marked `"discovered"` so
   * the popup groups it as unverified and never prices it.
   */
  async getTokenBalances(req: { address: string }): Promise<TokenBalance[]> {
    const settings = await this.loadNetworkSettings();
    const [watched, hidden] = await Promise.all([
      this.loadWatchedProcessIds(req.address),
      loadHiddenProcessIds(this.storage, req.address),
    ]);
    const baseIds = [...new Set([DEFAULT_AO_PROCESS_ID, ...watched])];
    const skip = new Set([...baseIds, ...hidden]);

    const [base, discovered] = await Promise.all([
      Promise.all(
        baseIds.map((processId) =>
          tokenRow(this.storage, req.address, processId, settings, processId === DEFAULT_AO_PROCESS_ID ? "default" : "watched"),
        ),
      ),
      this.discoveredProcessIds(req.address, settings).then((ids) =>
        Promise.all(
          ids.filter((id) => !skip.has(id)).map((id) => tokenRow(this.storage, req.address, id, settings, "discovered")),
        ),
      ),
    ]);
    const kept = discovered.filter(
      (row) =>
        row.available !== false &&
        /^\d+$/.test(row.quantity) &&
        BigInt(row.quantity) > 0n &&
        !impersonatesRegisteredToken({ ticker: row.ticker, name: row.name }),
    );
    return [...base, ...kept];
  }

  /**
   * `window.arweaveWallet.tokenBalance(id)`, Wander-shaped: one token's
   * atomic balance, read the way that token is routed. Read-only, so only
   * the connection grant gates it. A balance that can't be read is a
   * thrown error, never a fabricated `"0"`.
   */
  async tokenBalance(req: { address: string } & TokenBalanceRequest): Promise<TokenBalanceResult> {
    const settings = await this.loadNetworkSettings();
    const metadata = await loadTokenMetadata(this.storage, req.id, settings);
    return readBalance(this.storage, settings, {
      processId: req.id,
      address: req.address,
      transport: metadata.transport,
      label: metadata.ticker ?? "token",
    });
  }

  /** Read for a send: whether `processId` takes transfers as L1 transactions. */
  async tokenTransport(req: { processId: string }): Promise<TokenTransport> {
    const settings = await this.loadNetworkSettings();
    return (await loadTokenMetadata(this.storage, req.processId, settings)).transport;
  }

  /**
   * `window.arweaveWallet.userTokens(options?)`, in Wander's shape. Reads
   * the same token list as `getTokenBalances`, then reshapes each entry.
   * The process-id fallback ticker is dropped rather than passed off as a
   * ticker. A row the popup would show as unavailable reports a `null`
   * balance and no `Denomination`: a dApp scaling a raw quantity by an
   * unconfirmed denomination could be off by orders of magnitude.
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

  getPendingTransfers(req: { address: string }): Promise<PendingTransfer[]> {
    return this.activity.getPendingTransfers(req);
  }

  getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    return this.activity.getActivity(req);
  }

  promotePendingActivity(address: string): Promise<void> {
    return this.activity.promotePendingActivity(address);
  }

  loadTrackedAddresses(): Promise<string[]> {
    return this.activity.loadTrackedAddresses();
  }

  getPortfolioHistory(req: {
    range: PortfolioHistoryRange;
    address?: string;
    scope?: PortfolioScope;
    currency?: DisplayCurrency;
  }): Promise<PortfolioHistory> {
    return this.prices.getPortfolioHistory(req);
  }

  getTokenPrices(req: { currency?: DisplayCurrency; processIds?: string[] } = {}): Promise<TokenPrice[]> {
    return this.prices.getTokenPrices(req);
  }

  getTokenPriceHistory(req: {
    processId: string | null;
    range: PortfolioHistoryRange;
    currency?: DisplayCurrency;
  }): Promise<TokenPriceHistory> {
    return this.prices.getTokenPriceHistory(req);
  }
}
