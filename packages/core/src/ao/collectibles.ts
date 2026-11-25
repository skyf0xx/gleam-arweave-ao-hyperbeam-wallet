import { collectibleKind, type Collectible } from "../models/collectible";
import { classifyAsset, createAssetScanner, type Tag } from "./asset-scan";
import { readL1Balance } from "./balance";
import { userErrorMessage } from "../models/user-errors";
import { L1_TOKEN_NODE_URLS, trimTrailingSlashes } from "../models/network";
import { isNamespaceEntry, nameCarrierLabel, readCarrierHolding, readCarrierState, type CarrierHolding } from "./names";
import { ARWEAVE_ID } from "../models/arweave-id";
import { mapLimit } from "../models/concurrency";
import { withRequestTimeout } from "../models/http";
import { tagMap } from "../models/tag";

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
  /** As in `readL1Balance`. */
  l1NodeUrls?: readonly string[];
}

const DEFAULTS = { maxPages: 5, maxCandidates: 300, concurrency: 6, budgetMs: 60_000 };

function clean(value: string | undefined, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Only a Permaweb Name's display name starts with `@` (`permawebNameLabel`). */
function displayName(t: Record<string, string>): string {
  const name = (clean(t.name, 128) || clean(t.ticker, 32)).replace(/^@+/, "");
  return name || "Unnamed asset";
}

function shortenId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/**
 * Finds the AO NFTs and Permaweb Names `address` holds: candidate processes from the
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
  const { scanMany, fetchTags } = createAssetScanner({
    gatewayUrl,
    fetchImpl,
    maxPages,
    concurrency,
    deadline,
    describe: (gateway, detail) => userErrorMessage("collectibleLookupFailed", { gateway, detail }),
  });

  const [initial = [], market = [], received = []] = await scanMany([
    { filter: { tags: [{ name: "initial-holder", values: [address] }] } },
    { filter: { tags: [{ name: "action", values: ["register-interest", "make-offer"] }], owners: [address] }, pick: (node) => node.recipient },
    {
      filter: {
        tags: [
          { name: "action", values: ["transfer"] },
          { name: "recipient", values: [address] },
        ],
      },
      pick: (node) => node.recipient,
    },
  ]);
  const candidates = [...new Set([...initial, ...market, ...received])].slice(0, maxCandidates);

  const descriptors = await fetchTags(candidates);
  const uniques = candidates.filter((id) => {
    const tags = descriptors.get(id);
    return tags !== undefined && classifyAsset(tags) === "unique";
  });
  const names = candidates.flatMap((id) => {
    const tags = descriptors.get(id);
    const label = tags === undefined ? null : nameCarrierLabel(tags);
    return label === null ? [] : [{ id, label }];
  });

  const nodeUrls = options.l1NodeUrls ?? L1_TOKEN_NODE_URLS;
  const stateHosts = [...new Set([gatewayUrl, ...nodeUrls, peerUrl])];
  const namespaceHosts = [...new Set([gatewayUrl, ...nodeUrls])];
  // Concurrent, so a wallet with many NFTs doesn't spend the whole budget before its names.
  const [checks, nameChecks] = await Promise.all([
    mapLimit(uniques, concurrency, async (id) => {
      if (Date.now() >= deadline) return null;
      try {
        return await readL1Balance(id, address, gatewayUrl, peerUrl, fetchImpl, undefined, options.l1NodeUrls);
      } catch {
        return undefined;
      }
    }),
    mapLimit(names, concurrency, async ({ id, label }) => {
      if (Date.now() >= deadline) return null;
      let holding: CarrierHolding | null;
      try {
        holding = readCarrierHolding(await readCarrierState(id, stateHosts, fetchImpl), address);
      } catch {
        return undefined;
      }
      if (holding === null || !(await isNamespaceEntry(label, id, namespaceHosts, fetchImpl))) return null;
      return { id, label, holding };
    }),
  ]);
  if (uniques.length + names.length > 0 && [...checks, ...nameChecks].every((check) => check === undefined)) {
    throw new Error(userErrorMessage("collectibleBalanceFailed", { peer: peerUrl }));
  }
  const held = uniques.filter((_, index) => {
    const quantity = checks[index];
    return typeof quantity === "string" && BigInt(quantity) > 0n;
  });

  const collectionIds = new Set<string>();
  for (const id of held) {
    const collection = clean(tagMap(descriptors.get(id) ?? [])["base-collection"], 128);
    if (ARWEAVE_ID.test(collection)) collectionIds.add(collection);
  }
  let collectionTags = new Map<string, Tag[]>();
  if (collectionIds.size > 0) {
    try {
      collectionTags = await fetchTags([...collectionIds]);
    } catch {
      // Names are cosmetic: fall back to shortened ids rather than hide the NFTs.
    }
  }

  // `/raw/`: HyperBEAM gateways (arweave.net) answer `/<id>` for an AO
  // process with a 200 and an empty body. The URL only ever loads through
  // <img> or <video>, so losing the sandbox subdomain is harmless.
  const media = `${trimTrailingSlashes(gatewayUrl)}/raw`;
  const heldNames = nameChecks.flatMap((check) => (check ? [check] : []));
  const nameItems = heldNames.map(
    ({ id, label, holding }): Collectible => ({
      id,
      name: `@${label}`,
      ticker: "NAME",
      permawebName: {
        label,
        ...(holding.target !== undefined ? { target: holding.target } : {}),
        ...(holding.status === "listed" ? { listed: true as const } : {}),
      },
    }),
  );
  const assetItems = held.map((id): Collectible => {
    const t = tagMap(descriptors.get(id) ?? []);
    const ticker = clean(t.ticker, 32) || "ASSET";
    const contentType = clean(t["content-type"], 128);
    const kind = collectibleKind(contentType);
    const description = clean(t.description, 1000);
    const collection = clean(t["base-collection"], 128);
    const collectionId = ARWEAVE_ID.test(collection) ? collection : undefined;
    const collectionName = collectionId
      ? clean(tagMap(collectionTags.get(collectionId) ?? []).name, 128) || shortenId(collectionId)
      : undefined;
    return {
      id,
      name: displayName(t),
      ticker,
      ...(contentType ? { contentType } : {}),
      ...(kind === "image" ? { imageUrl: `${media}/${id}` } : {}),
      ...(kind === "video" ? { videoUrl: `${media}/${id}` } : {}),
      ...(description ? { description } : {}),
      ...(collectionId ? { collectionId, collectionName } : {}),
    };
  });
  return [...assetItems, ...nameItems];
}
