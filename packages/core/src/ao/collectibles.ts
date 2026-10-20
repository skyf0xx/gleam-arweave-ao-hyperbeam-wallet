import type { Collectible } from "../models/collectible";
import { classifyAsset, createAssetScanner, mapLimit, PROCESS_ID, tagMap, withRequestTimeout, type Tag } from "./asset-scan";
import { getTokenBalance } from "./balance";

export { classifyAsset } from "./asset-scan";
export type { AssetClass } from "./asset-scan";

export interface DiscoverCollectiblesOptions {
  address: string;
  gatewayUrl: string;
  peerUrl: string;
  fetchImpl?: typeof fetch;
  /** Pages (100 each) read per candidate source. */
  maxPages?: number;
  /** Candidate processes classified and balance-checked, newest first. */
  maxCandidates?: number;
  concurrency?: number;
  /** Past this, discovery stops fetching and returns what it has confirmed. */
  budgetMs?: number;
}

const DEFAULTS = { maxPages: 5, maxCandidates: 300, concurrency: 6, budgetMs: 60_000 };

function clean(value: string | undefined, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function shortenId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/**
 * Finds the AO NFTs `address` holds: candidate processes from the
 * gateway (assets it was the initial holder of, assets it has made market
 * actions on, assets transferred to it) -> classify by spawn tags -> keep
 * those with a positive balance. "Held" can't be read from the tags,
 * since a candidate may have been sold or sent on since.
 *
 * Bounded: `maxPages` per source, `maxCandidates` overall, balance checks
 * at `concurrency`, a per-request timeout and an overall `budgetMs`.
 * Throws when every balance check fails (peer down), so the caller
 * doesn't cache "holds nothing" for what was only an outage.
 */
export async function discoverCollectibles(options: DiscoverCollectiblesOptions): Promise<Collectible[]> {
  const { address, gatewayUrl, peerUrl } = options;
  const maxPages = options.maxPages ?? DEFAULTS.maxPages;
  const maxCandidates = options.maxCandidates ?? DEFAULTS.maxCandidates;
  const concurrency = options.concurrency ?? DEFAULTS.concurrency;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULTS.budgetMs);
  const fetchImpl = withRequestTimeout(options.fetchImpl ?? fetch);
  const { scan, fetchTags } = createAssetScanner({
    gatewayUrl,
    fetchImpl,
    maxPages,
    concurrency,
    deadline,
    describe: (gw, detail) => `Collectible lookup against "${gw}" failed: ${detail}`,
  });

  const [initial, market, received] = await Promise.all([
    scan({ tags: [{ name: "initial-holder", values: [address] }] }),
    scan({ tags: [{ name: "action", values: ["register-interest", "make-offer"] }], owners: [address] }, (node) => node.recipient),
    scan(
      {
        tags: [
          { name: "action", values: ["transfer"] },
          { name: "recipient", values: [address] },
        ],
      },
      (node) => node.recipient,
    ),
  ]);
  const candidates = [...new Set([...initial, ...market, ...received])].slice(0, maxCandidates);

  const descriptors = await fetchTags(candidates);
  const uniques = candidates.filter((id) => {
    const tags = descriptors.get(id);
    return tags !== undefined && classifyAsset(tags) === "unique";
  });

  // Assets on the arweave-scheduler@1.0 device are computed by the
  // gateway's HyperBEAM node, while legacy-AO peers such as
  // state.forward.computer answer 500 for them. Ask the gateway first.
  const balanceHosts = [...new Set([gatewayUrl.replace(/\/+$/, ""), peerUrl.replace(/\/+$/, "")])];
  const checks = await mapLimit(uniques, concurrency, async (id) => {
    if (Date.now() >= deadline) return null;
    for (const host of balanceHosts) {
      try {
        return (await getTokenBalance(id, address, host, fetchImpl)).quantity;
      } catch {
        // Try the next host.
      }
    }
    return undefined;
  });
  if (uniques.length > 0 && checks.every((quantity) => quantity === undefined)) {
    throw new Error(`Could not read any collectible balance from ${peerUrl}.`);
  }
  const held = uniques.filter((_, index) => {
    const quantity = checks[index];
    return typeof quantity === "string" && BigInt(quantity) > 0n;
  });

  const collectionIds = new Set<string>();
  for (const id of held) {
    const collection = clean(tagMap(descriptors.get(id) ?? [])["base-collection"], 128);
    if (PROCESS_ID.test(collection)) collectionIds.add(collection);
  }
  let collectionTags = new Map<string, Tag[]>();
  if (collectionIds.size > 0) {
    try {
      collectionTags = await fetchTags([...collectionIds]);
    } catch {
      // Names are cosmetic: fall back to shortened ids rather than hide the NFTs.
    }
  }

  const gateway = gatewayUrl.replace(/\/+$/, "");
  return held.map((id): Collectible => {
    const t = tagMap(descriptors.get(id) ?? []);
    const ticker = clean(t.ticker, 32) || "ASSET";
    const contentType = clean(t["content-type"], 128);
    const collection = clean(t["base-collection"], 128);
    const collectionId = PROCESS_ID.test(collection) ? collection : undefined;
    const collectionName = collectionId
      ? clean(tagMap(collectionTags.get(collectionId) ?? []).name, 128) || shortenId(collectionId)
      : undefined;
    return {
      id,
      name: clean(t.name, 128) || clean(t.ticker, 32) || "Unnamed asset",
      ticker,
      ...(contentType ? { contentType } : {}),
      ...(contentType.toLowerCase().startsWith("image/") ? { imageUrl: `${gateway}/${id}` } : {}),
      ...(collectionId ? { collectionId, collectionName } : {}),
    };
  });
}
