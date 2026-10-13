import { postGraphQLWithFailover } from "../arweave/graphql";
import type { Collectible } from "../models/collectible";
import { getTokenBalance } from "./balance";

interface Tag {
  name: string;
  value: string;
}

interface Node {
  id: string;
  recipient?: string | null;
  tags: Tag[];
}

interface ConnectionResponse {
  data?: { transactions?: { pageInfo?: { hasNextPage: boolean }; edges: Array<{ cursor: string; node: Node }> } };
}

export type AssetClass = "unique" | "fungible";

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

const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULTS = { maxPages: 5, maxCandidates: 300, concurrency: 6, budgetMs: 60_000 };

const SCAN_QUERY = `query ($first: Int!, $after: String, $owners: [String!], $tags: [TagFilter!]!) {
  transactions(first: $first, after: $after, sort: HEIGHT_DESC, owners: $owners, tags: $tags) {
    pageInfo { hasNextPage }
    edges { cursor node { id recipient tags { name value } } }
  }
}`;

const DESCRIPTOR_QUERY = `query ($ids: [ID!]!, $first: Int!) {
  transactions(first: $first, ids: $ids) {
    edges { cursor node { id tags { name value } } }
  }
}`;

function tagMap(tags: Tag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) {
    if (typeof tag?.name === "string" && typeof tag.value === "string") out[tag.name.toLowerCase()] = tag.value;
  }
  return out;
}

function clean(value: string | undefined, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Classifies a process by its spawn tags. A "unique" is the NFT shape:
 * non-fungible style, denomination 0, supply 1 and the `ASSET` ticker.
 * Anything that isn't a token@1.0 process (or isn't tagged fungible or
 * unique) is rejected, so unrelated processes that merely received a
 * message never reach the balance check.
 */
export function classifyAsset(tags: Tag[]): AssetClass | null {
  const t = tagMap(tags);
  if (t.device !== "process@1.0" || t["execution-device"] !== "token@1.0") return null;
  const style = t["hint-ui-style"] ?? t["hint-style"] ?? t["asset-type"];
  if (style === "non-fungible" && t.denomination === "0" && t["total-supply"] === "1" && t.ticker === "ASSET") {
    return "unique";
  }
  return style === "fungible" ? "fungible" : null;
}

function shortenId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 5)}…${id.slice(-4)}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index] as T);
      }
    }),
  );
  return out;
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
  const baseFetch = options.fetchImpl ?? fetch;
  const fetchImpl = ((input, init) =>
    baseFetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })) as typeof fetch;
  const describe = (gw: string, detail: string) => `Collectible lookup against "${gw}" failed: ${detail}`;

  const query = async (q: string, variables: Record<string, unknown>) =>
    (await postGraphQLWithFailover<ConnectionResponse>(gatewayUrl, q, variables, fetchImpl, describe)).data
      ?.transactions;

  const scan = async (tags: Array<{ name: string; values: string[] }>, owners?: string[], pick?: (node: Node) => string | null | undefined) => {
    const ids: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages && Date.now() < deadline; page++) {
      const connection = await query(SCAN_QUERY, { first: PAGE_SIZE, after, owners, tags });
      const edges = connection?.edges ?? [];
      for (const { node } of edges) {
        const id = pick ? pick(node) : node.id;
        if (id && PROCESS_ID.test(id)) ids.push(id);
      }
      if (!connection?.pageInfo?.hasNextPage || edges.length === 0) break;
      after = edges[edges.length - 1]?.cursor;
    }
    return ids;
  };

  const [initial, market, received] = await Promise.all([
    scan([{ name: "initial-holder", values: [address] }]),
    scan([{ name: "action", values: ["register-interest", "make-offer"] }], [address], (node) => node.recipient),
    scan(
      [
        { name: "action", values: ["transfer"] },
        { name: "recipient", values: [address] },
      ],
      undefined,
      (node) => node.recipient,
    ),
  ]);
  const candidates = [...new Set([...initial, ...market, ...received])].slice(0, maxCandidates);

  const fetchTags = async (ids: string[]): Promise<Map<string, Tag[]>> => {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += PAGE_SIZE) batches.push(ids.slice(i, i + PAGE_SIZE));
    const found = new Map<string, Tag[]>();
    await mapLimit(batches, concurrency, async (batch) => {
      if (Date.now() >= deadline) return;
      const connection = await query(DESCRIPTOR_QUERY, { ids: batch, first: PAGE_SIZE });
      for (const { node } of connection?.edges ?? []) found.set(node.id, node.tags);
    });
    return found;
  };

  const descriptors = await fetchTags(candidates);
  const uniques = candidates.filter((id) => {
    const tags = descriptors.get(id);
    return tags !== undefined && classifyAsset(tags) === "unique";
  });

  const checks = await mapLimit(uniques, concurrency, async (id) => {
    if (Date.now() >= deadline) return null;
    try {
      return (await getTokenBalance(id, address, peerUrl, fetchImpl)).quantity;
    } catch {
      return undefined;
    }
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
