import {
  discoverCollectibles,
  discoverTokens,
  getTransferOutcome,
  readLegacyTokenInfo,
  readTokenBalance,
} from "@gleam/core/src/ao/index.ts";
import { getBalance as getArBalance } from "@gleam/core/src/arweave/balance.ts";
import {
  queryActivityTransactions,
  queryAoTransferActivity,
  queryL1TokenReceipts,
} from "@gleam/core/src/arweave/graphql.ts";
import { queryTokenMetadata, tokenLogoUrl } from "@gleam/core/src/arweave/token-metadata.ts";
import { mergeActivity } from "@gleam/core/src/activity/index.ts";
import {
  AO_TOKEN,
  AR_TOKEN,
  DEFAULT_TOKEN_REGISTRY,
  buildPriceAtFromSeries,
  estimateHistoricalPortfolioValue,
  getHistoricalUsdPrices,
  getUsdFxRate,
  getUsdPrice,
  impersonatesRegisteredToken,
  type HistoricalPricePoint,
} from "@gleam/core/src/pricing/index.ts";
import { DEFAULT_HYPERBEAM_PEER_URLS, POINTS_API_URL, isFiatCurrency } from "@gleam/core";
import type {
  ActivityEntry,
  ActivityPage,
  Collectible,
  DisplayCurrency,
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
  TimerPort,
  TokenTransport,
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
 *   `arweave.net` and the default HyperBEAM peer.
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
const NETWORK_SETTINGS_KEY = "local:networkSettings";
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";
const WATCHED_PROCESS_IDS_KEY_PREFIX = "local:watchedProcessIds:";
const TOKEN_METADATA_KEY_PREFIX = "local:tokenMetadata:";
const HIDDEN_PROCESS_IDS_KEY_PREFIX = "local:hiddenProcessIds:";
const DISCOVERED_TOKENS_KEY_PREFIX = "local:discoveredTokens:";
// Discovery is a handful of gateway queries; a popup open inside this
// window reuses the last result.
const DISCOVERED_TOKENS_TTL_MS = 10 * 60 * 1000;
const FIRST_DISCOVERY_WAIT_MS = 8_000;
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

/** Always listed, whatever the watch list holds. */
const DEFAULT_AO_PROCESS_ID = AO_TOKEN.processId as string;

const AO_TOKEN_METADATA: TokenMetadata = {
  processId: DEFAULT_AO_PROCESS_ID,
  transport: "mu",
  assetClass: null,
  denomination: 12,
  ticker: AO_TOKEN.ticker,
  name: AO_TOKEN.name,
  description: null,
  logo: null,
  totalSupply: null,
};

const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The row fields that come from metadata alone. The ticker falls back to the process id, as the popup expects. */
function tokenIdentity(
  address: string,
  metadata: TokenMetadata,
  source: NonNullable<TokenBalance["source"]>,
  gatewayUrl: string,
): Omit<TokenBalance, "quantity"> {
  const logoUrl = source === "discovered" ? null : tokenLogoUrl(gatewayUrl, metadata.logo);
  return {
    address,
    processId: metadata.processId,
    ticker: metadata.ticker ?? metadata.processId,
    denomination: metadata.denomination ?? 0,
    name: metadata.name,
    source,
    ...(logoUrl ? { logoUrl } : {}),
  };
}

function isValidTokenMetadata(value: unknown): value is TokenMetadata {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.processId === "string" &&
    (candidate.transport === "l1" || candidate.transport === "mu") &&
    (candidate.assetClass === null || candidate.assetClass === "fungible" || candidate.assetClass === "unique") &&
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

interface DiscoveredTokensCache {
  savedAt: number;
  processIds: string[];
}

function isDiscoveredTokensCache(value: unknown): value is DiscoveredTokensCache {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.savedAt === "number" &&
    Array.isArray(candidate.processIds) &&
    candidate.processIds.every((id) => typeof id === "string")
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
  private readonly discoveryInFlight = new Map<string, Promise<string[]>>();

  /**
   * `pricesApiUrl` is the Gleam server, which proxies CoinGecko/CoinPaprika
   * for users who can't reach them. `discover` finds a wallet's tokens.
   */
  constructor(
    private readonly storage: StoragePort,
    private readonly pricesApiUrl: string = POINTS_API_URL,
    private readonly discover: (options: { address: string; gatewayUrl: string }) => Promise<TokenMetadata[]> = discoverTokens,
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

  private async loadHiddenProcessIds(address: string): Promise<string[]> {
    const raw = await this.storage.get<unknown>(`${HIDDEN_PROCESS_IDS_KEY_PREFIX}${address}`);
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === "string");
  }

  /**
   * A token's identity and transport. AO is fixed. Any other token comes
   * from its spawn tags, plus, for a legacy token whose Lua sets its
   * ticker and denomination, its `Info` reply. Cached by process id with
   * no expiry once complete; spawn tags and a token's Info don't change.
   * Throws with a message the add-token preview can show as-is.
   */
  private async loadTokenMetadata(processId: string, gatewayUrl: string): Promise<TokenMetadata> {
    if (processId === DEFAULT_AO_PROCESS_ID) return AO_TOKEN_METADATA;
    const cacheKey = `${TOKEN_METADATA_KEY_PREFIX}${processId}`;
    const cached = await this.storage.get<unknown>(cacheKey);
    if (isValidTokenMetadata(cached)) return cached;

    let metadata: TokenMetadata;
    try {
      metadata = await queryTokenMetadata(processId, gatewayUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.startsWith("No spawn transaction")
          ? "No process with that id is on Arweave yet. Check that you copied the whole id; a token spawned in the last few minutes may not be indexed yet."
          : `Couldn't reach ${hostOf(gatewayUrl)} to look up that token. Check your connection, or switch gateways in Network settings, then try again.`,
      );
    }
    if (metadata.transport === "mu" && (metadata.ticker === null || metadata.denomination === null)) {
      try {
        const info = await readLegacyTokenInfo(processId);
        metadata = {
          ...metadata,
          ticker: info.ticker ?? metadata.ticker,
          name: info.name ?? metadata.name,
          denomination: info.denomination ?? metadata.denomination,
          logo: info.logo ?? metadata.logo,
        };
      } catch {
        // Spawn tags alone; not cached, so the next read retries Info.
        return metadata;
      }
    }
    await this.storage.set(cacheKey, metadata);
    return metadata;
  }

  private async tryTokenMetadata(processId: string, gatewayUrl: string): Promise<TokenMetadata | null> {
    try {
      return await this.loadTokenMetadata(processId, gatewayUrl);
    } catch {
      return null;
    }
  }

  /**
   * One token row. A failed read marks only this row unavailable, with the
   * reason, rather than failing every other token's balance too. A token
   * whose denomination can't be confirmed is unavailable as well: scaling
   * its quantity by a guess could be off by orders of magnitude.
   */
  private async tokenRow(
    address: string,
    processId: string,
    settings: NetworkSettings,
    source: NonNullable<TokenBalance["source"]>,
  ): Promise<TokenBalance> {
    const metadata = await this.tryTokenMetadata(processId, settings.gatewayUrl);
    if (metadata === null) {
      return {
        address,
        processId,
        ticker: processId,
        denomination: 0,
        name: null,
        quantity: "0",
        available: false,
        unavailableReason: "Couldn't look up this token's details. Try again in a minute.",
        source,
      };
    }
    const identity = tokenIdentity(address, metadata, source, settings.gatewayUrl);
    try {
      const quantity = await readTokenBalance({
        processId,
        address,
        transport: metadata.transport,
        gatewayUrl: settings.gatewayUrl,
        peerUrl: settings.activePeerUrl,
        label: identity.ticker === processId ? "token" : identity.ticker,
      });
      if (metadata.denomination === null) {
        return { ...identity, quantity, available: false, unavailableReason: "This token doesn't say how many decimals it uses." };
      }
      return { ...identity, quantity };
    } catch (error) {
      return {
        ...identity,
        quantity: "0",
        available: false,
        unavailableReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Process ids found from the wallet's history (`core/ao/token-discovery.ts`),
   * cached per wallet for `DISCOVERED_TOKENS_TTL_MS`. A stale cache is
   * served while a refresh runs in the background, so only a wallet's
   * first read waits on discovery, and for at most
   * `FIRST_DISCOVERY_WAIT_MS`. A failed discovery leaves the cache as it
   * was.
   */
  private async discoveredProcessIds(address: string, settings: NetworkSettings): Promise<string[]> {
    const key = `${DISCOVERED_TOKENS_KEY_PREFIX}${address}`;
    const raw = await this.storage.get<unknown>(key);
    const cached = isDiscoveredTokensCache(raw) ? raw : null;
    if (cached && Date.now() - cached.savedAt < DISCOVERED_TOKENS_TTL_MS) return cached.processIds;

    let running = this.discoveryInFlight.get(address);
    if (!running) {
      running = (async () => {
        try {
          const found = await this.discover({ address, gatewayUrl: settings.gatewayUrl });
          await Promise.all(
            found
              .filter((metadata) => metadata.transport === "l1" && metadata.denomination !== null)
              .map((metadata) => this.storage.set(`${TOKEN_METADATA_KEY_PREFIX}${metadata.processId}`, metadata)),
          );
          const processIds = found.map((metadata) => metadata.processId);
          await this.storage.set<DiscoveredTokensCache>(key, { savedAt: Date.now(), processIds });
          return processIds;
        } catch (error) {
          console.warn(`Token discovery for "${address}" failed:`, error);
          return cached?.processIds ?? [];
        } finally {
          this.discoveryInFlight.delete(address);
        }
      })();
      this.discoveryInFlight.set(address, running);
    }
    if (cached) return cached.processIds;
    // A first discovery can take tens of seconds on a slow gateway; past
    // this wait the balances return without it, and the next read has it.
    return Promise.race([
      running,
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), FIRST_DISCOVERY_WAIT_MS)),
    ]);
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
    if (processId.length === 0) throw new Error("Paste a token's process id.");
    if (!PROCESS_ID.test(processId)) {
      throw new Error(
        "That isn't a process id. A process id is 43 letters, digits, - and _; copy it from the token's page or explorer.",
      );
    }
    if (processId === req.address) throw new Error("That's your wallet address, not a token's process id.");
    const settings = await this.loadNetworkSettings();
    const metadata = await this.loadTokenMetadata(processId, settings.gatewayUrl);
    if (metadata.assetClass === "unique") {
      throw new Error("That's a collectible, not a token. Collectibles you hold show up in the Collectibles tab on their own.");
    }
    if (metadata.ticker === null && metadata.name === null) {
      throw new Error("That process doesn't describe itself as a token (it has no name or ticker). Check the id.");
    }
    return this.tokenRow(req.address, processId, settings, "watched");
  }

  /**
   * Persists a previewed process id to the watch list, and un-hides it.
   * Re-resolves rather than trusting a client-supplied preview. No-op
   * (but not an error) for an id that's already watched, or for the
   * default AO process id, which is always shown without being stored.
   */
  async addWatchedToken(req: { address: string; processId: string }): Promise<TokenBalance> {
    const resolved = await this.previewWatchedToken(req);
    const processId = resolved.processId;

    if (processId !== DEFAULT_AO_PROCESS_ID) {
      const existing = await this.loadWatchedProcessIds(req.address);
      if (!existing.includes(processId)) {
        await this.storage.set(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, [...existing, processId]);
      }
    }
    const hidden = await this.loadHiddenProcessIds(req.address);
    if (hidden.includes(processId)) {
      await this.storage.set(
        `${HIDDEN_PROCESS_IDS_KEY_PREFIX}${req.address}`,
        hidden.filter((id) => id !== processId),
      );
    }
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
    const existing = await this.loadWatchedProcessIds(req.address);
    const next = existing.filter((id) => id !== req.processId);
    if (next.length !== existing.length) {
      await this.storage.set(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${req.address}`, next);
    }
    const hidden = await this.loadHiddenProcessIds(req.address);
    if (!hidden.includes(req.processId)) {
      await this.storage.set(`${HIDDEN_PROCESS_IDS_KEY_PREFIX}${req.address}`, [...hidden, req.processId]);
    }
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
      this.loadHiddenProcessIds(req.address),
    ]);
    const baseIds = [...new Set([DEFAULT_AO_PROCESS_ID, ...watched])];
    const skip = new Set([...baseIds, ...hidden]);

    const [base, discovered] = await Promise.all([
      Promise.all(
        baseIds.map((processId) =>
          this.tokenRow(req.address, processId, settings, processId === DEFAULT_AO_PROCESS_ID ? "default" : "watched"),
        ),
      ),
      this.discoveredProcessIds(req.address, settings).then((ids) =>
        Promise.all(
          ids.filter((id) => !skip.has(id)).map((id) => this.tokenRow(req.address, id, settings, "discovered")),
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
    const metadata = await this.loadTokenMetadata(req.id, settings.gatewayUrl);
    return readTokenBalance({
      processId: req.id,
      address: req.address,
      transport: metadata.transport,
      gatewayUrl: settings.gatewayUrl,
      peerUrl: settings.activePeerUrl,
      label: metadata.ticker ?? "token",
    });
  }

  /** Read for a send: whether `processId` takes transfers as L1 transactions. */
  async tokenTransport(req: { processId: string }): Promise<TokenTransport> {
    const settings = await this.loadNetworkSettings();
    return (await this.loadTokenMetadata(req.processId, settings.gatewayUrl)).transport;
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

  async getActivity(req: { address: string; cursor?: string }): Promise<ActivityPage> {
    void req.cursor; // most-recent-N only — no deeper pagination cursor is implemented yet.
    const settings = await this.loadNetworkSettings();
    const [localLog, arEntries, aoEntries, l1Receipts] = await Promise.all([
      this.loadActivityLog(req.address),
      queryActivityTransactions(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
      queryAoTransferActivity(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT),
      // Receipts are extra detail; a failed query shouldn't blank the feed.
      queryL1TokenReceipts(req.address, settings.gatewayUrl, ACTIVITY_PAGE_LIMIT).catch(() => []),
    ]);
    const receipts = await this.receiptsForListedTokens(req.address, l1Receipts, settings);
    const gatewayEntries = [...(await this.resolveSingleUnitTransfers([...arEntries, ...aoEntries], settings)), ...receipts];

    return mergeActivity(localLog, gatewayEntries, ACTIVITY_PAGE_LIMIT);
  }

  /**
   * An L1 receipt is anyone's claim, so one is kept only for a token the
   * user already lists (watched, or discovered and not hidden) whose
   * spawn tags make it a fungible `arweave-scheduler@1.0` token. Reads
   * only cached discovery, never starting one.
   */
  private async receiptsForListedTokens(
    address: string,
    receipts: ActivityEntry[],
    settings: NetworkSettings,
  ): Promise<ActivityEntry[]> {
    if (receipts.length === 0) return [];
    const [watched, hidden, rawDiscovered] = await Promise.all([
      this.loadWatchedProcessIds(address),
      this.loadHiddenProcessIds(address),
      this.storage.get<unknown>(`${DISCOVERED_TOKENS_KEY_PREFIX}${address}`),
    ]);
    const discovered = isDiscoveredTokensCache(rawDiscovered) ? rawDiscovered.processIds : [];
    const listed = new Set([...watched, ...discovered].filter((id) => !hidden.includes(id)));
    const tokens = [...new Set(receipts.flatMap((entry) => (entry.token && listed.has(entry.token) ? [entry.token] : [])))];
    const fungible = new Set<string>();
    await Promise.all(
      tokens.map(async (id) => {
        const metadata = await this.tryTokenMetadata(id, settings.gatewayUrl);
        if (metadata?.transport === "l1" && metadata.assetClass === "fungible") fungible.add(id);
      }),
    );
    return receipts.filter((entry) => entry.token && fungible.has(entry.token));
  }

  /**
   * The gateway parser reads the wallet's own L1 transfer of exactly 1
   * unit as a collectible send. Where the process's spawn tags say it is
   * a fungible token, the entry becomes a 1-unit token send instead.
   */
  private async resolveSingleUnitTransfers(entries: ActivityEntry[], settings: NetworkSettings): Promise<ActivityEntry[]> {
    const ids = [...new Set(entries.flatMap((entry) => (entry.collectible && !entry.token ? [entry.collectible.id] : [])))];
    if (ids.length === 0) return entries;
    const fungible = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        const metadata = await this.tryTokenMetadata(id, settings.gatewayUrl);
        if (metadata?.assetClass === "fungible") fungible.add(id);
      }),
    );
    return entries.map((entry) => {
      if (!entry.collectible || !fungible.has(entry.collectible.id)) return entry;
      const { collectible, ...rest } = entry;
      return { ...rest, token: collectible.id, amount: "1" };
    });
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
        // An L1 token send settles through the gateway index, like an AR send.
        const metadata = await this.storage.get<unknown>(`${TOKEN_METADATA_KEY_PREFIX}${entry.token}`);
        if (isValidTokenMetadata(metadata) && metadata.transport === "l1") return entry;
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
    scope?: PortfolioScope;
    currency?: DisplayCurrency;
  }): Promise<PortfolioHistory> {
    if (!PORTFOLIO_HISTORY_RANGES.includes(req.range)) {
      throw new Error(`Unrecognized portfolio history range "${String(req.range)}".`);
    }

    const periodLabel = periodLabelForRange(req.range);
    const empty: PortfolioHistory = { range: req.range, series: [], currentValue: 0, change: 0, periodLabel };
    const currency = req.currency ?? "USD";
    const addresses = await this.resolvePortfolioAddresses(req.scope ?? "wallet");

    if (addresses.length === 0) return empty;

    const settings = await this.loadNetworkSettings();
    const arBalancesWinston = await Promise.all(addresses.map((address) => getArBalance(address, settings.gatewayUrl)));
    const arBalanceWinston = arBalancesWinston.reduce((sum, winston) => sum + BigInt(winston), 0n);
    const arBalance = Number(arBalanceWinston) / WINSTON_PER_AR;

    const arPriceSeries = AR_TOKEN.priceSource
      ? await getHistoricalUsdPrices(AR_TOKEN.priceSource, req.range, this.pricesApiUrl)
      : [];

    if (arPriceSeries.length === 0) return empty;

    const arPriceAt = buildPriceAtFromSeries(arPriceSeries);
    const tokens = [{ balance: arBalance, priceAt: arPriceAt }];
    let aoPriceSeries: HistoricalPricePoint[] | null = null;
    const loadAoPriceSeries = async () =>
      (aoPriceSeries ??= AO_TOKEN.priceSource ? await getHistoricalUsdPrices(AO_TOKEN.priceSource, req.range, this.pricesApiUrl) : []);

    if (AO_TOKEN.priceSource) {
      // A failed read leaves that wallet's AO out rather than failing the
      // whole chart whenever a peer hiccups — there's no way to tell whether
      // the wallet even holds AO.
      const aoQuantities = await Promise.all(
        addresses.map(async (address) => {
          try {
            const quantity = await readTokenBalance({
              processId: DEFAULT_AO_PROCESS_ID,
              address,
              transport: "mu",
              gatewayUrl: settings.gatewayUrl,
              peerUrl: settings.activePeerUrl,
            });
            return Number(quantity) / 10 ** (AO_TOKEN_METADATA.denomination ?? 12);
          } catch {
            return null;
          }
        }),
      );
      const readQuantities = aoQuantities.filter((quantity): quantity is number => quantity !== null);

      if (readQuantities.length > 0) {
        const aoQuantity = readQuantities.reduce((sum, quantity) => sum + quantity, 0);
        const series = await loadAoPriceSeries();
        if (series.length > 0) {
          tokens.push({ balance: aoQuantity, priceAt: buildPriceAtFromSeries(series) });
        } else if (aoQuantity > 0) {
          // A held AO balance with no price series would silently drop out of
          // the total, so an AO-only portfolio would chart as $0. Reported as
          // a failed range instead, like AR's own empty-series case.
          return empty;
        }
      }
    }

    let unitPriceAt: (timestamp: number) => number;
    if (currency === "AR") {
      unitPriceAt = arPriceAt;
    } else if (currency === "AO") {
      const series = await loadAoPriceSeries();
      if (series.length === 0) return empty;
      unitPriceAt = buildPriceAtFromSeries(series);
    } else {
      const rate = await getUsdFxRate(currency, this.pricesApiUrl);
      if (rate === null) return empty;
      unitPriceAt = () => 1 / rate;
    }

    const series = arPriceSeries.map((point) => {
      const unitPrice = unitPriceAt(point.timestamp);
      const usdValue = estimateHistoricalPortfolioValue(tokens, point.timestamp);
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
   * `price: null` (never a fabricated `0`); a token with no `priceSource`
   * at all (nothing outside the registry today) is skipped entirely
   * rather than returning a meaningless entry.
   */
  async getTokenPrices(req: { currency?: DisplayCurrency } = {}): Promise<TokenPrice[]> {
    const currency = req.currency ?? "USD";
    const priced = DEFAULT_TOKEN_REGISTRY.filter((token) => token.priceSource !== null);
    const [usdPrices, rate] = await Promise.all([
      Promise.all(
        priced.map(async (token) => ({
          token,
          usd: await getUsdPrice(token.priceSource as NonNullable<typeof token.priceSource>, this.pricesApiUrl),
        })),
      ),
      isFiatCurrency(currency) ? getUsdFxRate(currency, this.pricesApiUrl) : Promise.resolve(null),
    ]);

    const unitUsd = isFiatCurrency(currency)
      ? rate === null ? null : 1 / rate
      : (usdPrices.find(({ token }) => token.ticker === currency)?.usd ?? null);

    return usdPrices.map(({ token, usd }) => ({
      processId: token.processId,
      price: usd === null || unitUsd === null || unitUsd <= 0 ? null : usd / unitUsd,
    }));
  }
}

/**
 * Name of the timer this module registers — namespaced
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
 * Registers the `TimerPort` interval that actively promotes a
 * locally-pending activity entry to confirmed once the gateway indexes
 * it — independent of any popup being open. Only the timer registration
 * lives here; all the actual promotion/merge logic is `ReadsHandler.promotePendingActivity`, reusing
 * the existing `mergeActivity`-backed `getActivity` path rather than
 * duplicating it.
 *
 * Call once from the background entrypoint with a `ReadsHandler`
 * instance, e.g.: `registerActivityPromotionAlarm(new
 * ReadsHandler(storage), timer)`. Errors from an individual address's promotion
 * check are caught and logged per-address so one failing gateway/address
 * never blocks promotion for the wallet's other tracked addresses on the
 * same tick.
 */
export function registerActivityPromotionAlarm(handler: ReadsHandler, timer: TimerPort): void {
  timer.every(ACTIVITY_PROMOTION_ALARM_NAME, ACTIVITY_PROMOTION_INTERVAL_MINUTES, () => {
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
