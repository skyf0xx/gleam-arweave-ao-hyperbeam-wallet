import { postGraphQLWithFailover } from "../arweave/graphql";

export interface Tag {
  name: string;
  value: string;
}

export interface ScanNode {
  id: string;
  recipient?: string | null;
  owner?: { address: string };
  tags: Tag[];
}

interface ConnectionResponse {
  data?: { transactions?: { pageInfo?: { hasNextPage: boolean }; edges: Array<{ cursor: string; node: ScanNode }> } };
}

export type AssetClass = "unique" | "fungible";

export const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;
export const SCAN_PAGE_SIZE = 100;
export const SCAN_REQUEST_TIMEOUT_MS = 15_000;

const SCAN_QUERY = `query ($first: Int!, $after: String, $owners: [String!], $tags: [TagFilter!]!) {
  transactions(first: $first, after: $after, sort: HEIGHT_DESC, owners: $owners, tags: $tags) {
    pageInfo { hasNextPage }
    edges { cursor node { id recipient tags { name value } } }
  }
}`;

const SCAN_RECIPIENTS_QUERY = `query ($first: Int!, $after: String, $owners: [String!], $recipients: [String!], $tags: [TagFilter!]!) {
  transactions(first: $first, after: $after, sort: HEIGHT_DESC, owners: $owners, recipients: $recipients, tags: $tags) {
    pageInfo { hasNextPage }
    edges { cursor node { id recipient owner { address } tags { name value } } }
  }
}`;

const DESCRIPTOR_QUERY = `query ($ids: [ID!]!, $first: Int!) {
  transactions(first: $first, ids: $ids) {
    edges { cursor node { id tags { name value } } }
  }
}`;

/** Lower-cased tag names: gateways return spawn tags in whatever case the spawner wrote. */
export function tagMap(tags: Tag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of tags) {
    if (typeof tag?.name === "string" && typeof tag.value === "string") out[tag.name.toLowerCase()] = tag.value;
  }
  return out;
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

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export interface AssetScannerOptions {
  gatewayUrl: string;
  fetchImpl: typeof fetch;
  maxPages: number;
  concurrency: number;
  deadline: number;
  describe: (gatewayUrl: string, detail: string) => string;
}

export interface ScanFilter {
  tags: Array<{ name: string; values: string[] }>;
  owners?: string[];
  recipients?: string[];
}

/**
 * Paged gateway scans for the process ids an address has touched, and a
 * batched spawn-tag lookup for them. Bounded by `maxPages` per scan and
 * by `deadline` overall.
 */
export function createAssetScanner(options: AssetScannerOptions) {
  const { gatewayUrl, fetchImpl, maxPages, concurrency, deadline, describe } = options;

  const query = async (q: string, variables: Record<string, unknown>) =>
    (await postGraphQLWithFailover<ConnectionResponse>(gatewayUrl, q, variables, fetchImpl, describe)).data
      ?.transactions;

  const scan = async (filter: ScanFilter, pick?: (node: ScanNode) => string | null | undefined): Promise<string[]> => {
    const ids: string[] = [];
    let after: string | undefined;
    const q = filter.recipients ? SCAN_RECIPIENTS_QUERY : SCAN_QUERY;
    for (let page = 0; page < maxPages && Date.now() < deadline; page++) {
      const connection = await query(q, {
        first: SCAN_PAGE_SIZE,
        after,
        owners: filter.owners,
        ...(filter.recipients ? { recipients: filter.recipients } : {}),
        tags: filter.tags,
      });
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

  const fetchTags = async (ids: string[]): Promise<Map<string, Tag[]>> => {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += SCAN_PAGE_SIZE) batches.push(ids.slice(i, i + SCAN_PAGE_SIZE));
    const found = new Map<string, Tag[]>();
    await mapLimit(batches, concurrency, async (batch) => {
      if (Date.now() >= deadline) return;
      const connection = await query(DESCRIPTOR_QUERY, { ids: batch, first: SCAN_PAGE_SIZE });
      for (const { node } of connection?.edges ?? []) found.set(node.id, node.tags);
    });
    return found;
  };

  return { scan, fetchTags };
}

/** A fetch that gives every request its own timeout, so one hung host can't hold a scan past its budget. */
export function withRequestTimeout(fetchImpl: typeof fetch, timeoutMs: number = SCAN_REQUEST_TIMEOUT_MS): typeof fetch {
  return ((input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })) as typeof fetch;
}
