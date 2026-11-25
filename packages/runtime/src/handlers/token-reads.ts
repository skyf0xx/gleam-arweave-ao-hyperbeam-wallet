import {
  readLegacyTokenInfo,
  readTokenStateLogo,
  readTokenBalance,
  type ReadTokenBalanceOptions,
} from "@gleam/core/src/ao/index.ts";
import { z } from "zod";
import { peerFailoverOrder, withPeerFailover } from "@gleam/core/src/ao/peer-failover.ts";
import { crossCheckGatewayUrls, queryCheckedTokenMetadata, tokenLogoUrl, type TokenMetadataCheck } from "@gleam/core/src/arweave/token-metadata.ts";
import { AO_TOKEN } from "@gleam/core/src/pricing/index.ts";
import { errorMessage } from "@gleam/core";
import type { NetworkSettings, StoragePort, TokenBalance, TokenMetadata } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { readL1NodeUrls } from "../peers";
import { WATCHED_PROCESS_IDS_KEY_PREFIX } from "../storage-keys";
import { stringList } from "../guards";
import { schemaGuard } from "../schema-guard";

export const TOKEN_METADATA_KEY_PREFIX = "local:tokenMetadata:";
export const HIDDEN_PROCESS_IDS_KEY_PREFIX = "local:hiddenProcessIds:";
export const DISCOVERED_TOKENS_KEY_PREFIX = "local:discoveredTokens:";

/** Always listed, whatever the watch list holds. */
export const DEFAULT_AO_PROCESS_ID = AO_TOKEN.processId as string;

export const AO_TOKEN_METADATA: TokenMetadata = {
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


function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The row fields that come from metadata alone. The ticker falls back to the process id, as the popup expects.
 * A discovered token's logo is still the sender's claim; the popup draws it only once the user shows the row.
 */
function tokenIdentity(
  address: string,
  metadata: TokenMetadata,
  source: NonNullable<TokenBalance["source"]>,
  gatewayUrl: string,
): Omit<TokenBalance, "quantity"> {
  const logoUrl = tokenLogoUrl(gatewayUrl, metadata.logo);
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

const nullableString = z.string().nullable();

export const isValidTokenMetadata = schemaGuard<TokenMetadata>(
  z.object({
    processId: z.string(),
    transport: z.enum(["l1", "mu"]),
    assetClass: z.enum(["fungible", "unique"]).nullable(),
    denomination: z.number().lt(100).nullable(),
    ticker: nullableString,
    name: nullableString,
    description: nullableString,
    logo: nullableString,
    totalSupply: nullableString,
  }),
);

export interface DiscoveredTokensCache {
  savedAt: number;
  processIds: string[];
}

export const isDiscoveredTokensCache = schemaGuard<DiscoveredTokensCache>(
  z.object({ savedAt: z.number(), processIds: z.array(z.string()) }),
);

/**
 * A token balance, failing over to the other enabled peers when the
 * active one is down. An L1 token reads the peer only as a last resort
 * after the gateway and L1 nodes, so it gets one pass.
 */
export async function readBalance(
  storage: StoragePort,
  settings: NetworkSettings,
  options: Omit<ReadTokenBalanceOptions, "gatewayUrl" | "peerUrl">,
): Promise<string> {
  const peers = peerFailoverOrder(settings);
  const l1NodeUrls = options.transport === "l1" ? await readL1NodeUrls(storage) : undefined;
  const read = (peerUrl: string | null) =>
    readTokenBalance({ ...options, gatewayUrl: settings.gatewayUrl, peerUrl, ...(l1NodeUrls ? { l1NodeUrls } : {}) });
  if (peers.length === 0 || options.transport === "l1") return read(settings.activePeerUrl);
  return withPeerFailover(peers, read);
}

export async function loadWatchedProcessIds(storage: StoragePort, address: string): Promise<string[]> {
  return stringList(await storage.get<unknown>(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${address}`));
}

export async function loadHiddenProcessIds(storage: StoragePort, address: string): Promise<string[]> {
  return stringList(await storage.get<unknown>(`${HIDDEN_PROCESS_IDS_KEY_PREFIX}${address}`));
}

/**
 * A token's identity and transport. AO is fixed. Any other token comes
 * from its spawn tags, plus, for a legacy token whose Lua sets its
 * ticker and denomination, its `Info` reply. Cached by process id with
 * no expiry once complete; spawn tags and a token's Info don't change.
 * Throws with a message the add-token preview can show as-is.
 */
export async function loadTokenMetadata(storage: StoragePort, processId: string, settings: NetworkSettings): Promise<TokenMetadata> {
  const gatewayUrl = settings.gatewayUrl;
  if (processId === DEFAULT_AO_PROCESS_ID) return AO_TOKEN_METADATA;
  const cacheKey = `${TOKEN_METADATA_KEY_PREFIX}${processId}`;
  const cached = await storage.get<unknown>(cacheKey);
  if (isValidTokenMetadata(cached)) return cached;

  let metadata: TokenMetadata;
  let check: TokenMetadataCheck;
  try {
    ({ metadata, check } = await queryCheckedTokenMetadata(processId, gatewayUrl, crossCheckGatewayUrls(gatewayUrl)));
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(
      message.startsWith("No spawn transaction")
        ? userErrorMessage("tokenNotIndexed")
        : userErrorMessage("tokenLookupUnreachable", { host: hostOf(gatewayUrl) }),
    );
  }
  // Gateways that disagree on the decimals leave them unknown, so amounts show unscaled. Not cached: asked again next time.
  if (check === "disagreed") return metadata;
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
  if (metadata.logo === null && metadata.assetClass !== "unique") {
    // Current `token@1.0` processes keep `logo` in live state, not in spawn tags.
    // The host that serves this token's balance: arweave-scheduler tokens live on the gateway's node, legacy ones on the peer.
    const stateHost = metadata.transport === "l1" ? gatewayUrl : settings.activePeerUrl;
    try {
      if (stateHost === null) return metadata;
      metadata = { ...metadata, logo: await readTokenStateLogo(processId, stateHost) };
    } catch {
      // Not cached, so the next read asks again; the row just shows letters meanwhile.
      return metadata;
    }
  }
  // Unchecked decimals aren't kept, so the next read checks them again.
  if (check === "unconfirmed") return metadata;
  // A cache fill: the value comes from the network, not from what was stored.
  // eslint-disable-next-line gleam/no-storage-read-modify-write
  await storage.set(cacheKey, metadata);
  return metadata;
}

export async function tryTokenMetadata(storage: StoragePort, processId: string, settings: NetworkSettings): Promise<TokenMetadata | null> {
  try {
    return await loadTokenMetadata(storage, processId, settings);
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
export async function tokenRow(
  storage: StoragePort,
  address: string,
  processId: string,
  settings: NetworkSettings,
  source: NonNullable<TokenBalance["source"]>,
): Promise<TokenBalance> {
  const metadata = await tryTokenMetadata(storage, processId, settings);
  if (metadata === null) {
    return {
      address,
      processId,
      ticker: processId,
      denomination: 0,
      name: null,
      quantity: "0",
      available: false,
      unavailableReason: userErrorMessage("tokenDetailsUnavailable"),
      source,
    };
  }
  const identity = tokenIdentity(address, metadata, source, settings.gatewayUrl);
  try {
    const quantity = await readBalance(storage, settings, {
      processId,
      address,
      transport: metadata.transport,
      label: identity.ticker === processId ? "token" : identity.ticker,
    });
    if (metadata.denomination === null) {
      return { ...identity, quantity, available: false, unavailableReason: userErrorMessage("tokenNoDecimals") };
    }
    return { ...identity, quantity };
  } catch (error) {
    return {
      ...identity,
      quantity: "0",
      available: false,
      unavailableReason: errorMessage(error),
    };
  }
}
