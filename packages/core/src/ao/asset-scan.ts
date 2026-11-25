import { postGraphQLWithFailover } from "../arweave/graphql";
import { ARWEAVE_ID } from "../models/arweave-id";
import { mapLimit } from "../models/concurrency";
import { tagMap } from "../models/tag";

export { mapLimit } from "../models/concurrency";
export { withRequestTimeout } from "../models/http";
export { tagMap } from "../models/tag";

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

type Connection = NonNullable<NonNullable<ConnectionResponse["data"]>["transactions"]>;

export type AssetClass = "unique" | "fungible";

export const SCAN_PAGE_SIZE = 100;

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

/**
 * Classifies a process by its spawn tags. A "unique" is the NFT shape:
 * non-fungible style, denomination 0 and supply 1. The ticker is free:
 * a permaweb app published as an atomic asset carries `APP`. Anything that isn't a token@1.0 process (or isn't tagged fungible or
 * unique) is rejected, so unrelated processes that merely received a
 * message never reach the balance check.
 */
export function classifyAsset(tags: Tag[]): AssetClass | null {
  const t = tagMap(tags);
  if (t.device !== "process@1.0" || t["execution-device"] !== "token@1.0") return null;
  const style = t["hint-ui-style"] ?? t["hint-style"] ?? t["asset-type"];
  if (style === "non-fungible" && t.denomination === "0" && t["total-supply"] === "1") {
    return "unique";
  }
  return style === "fungible" ? "fungible" : null;
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
        if (id && ARWEAVE_ID.test(id)) ids.push(id);
      }
      if (!connection?.pageInfo?.hasNextPage || edges.length === 0) break;
      after = edges[edges.length - 1]?.cursor;
    }
    return ids;
  };

  /**
   * Pages several tag scans in one aliased query per round, so N sources
   * cost one request per page instead of N. The public gateways rate-limit
   * (HTTP 429) on request count, and a failed round loses every source
   * anyway, so batching only removes calls. Sources that run out of pages
   * drop out of later rounds. Results come back in `sources` order.
   */
  const scanMany = async (
    sources: Array<{ filter: Omit<ScanFilter, "recipients">; pick?: (node: ScanNode) => string | null | undefined }>,
  ): Promise<string[][]> => {
    const ids: string[][] = sources.map(() => []);
    const cursors: Array<string | undefined> = sources.map(() => undefined);
    let active = sources.map((_, index) => index);
    for (let page = 0; page < maxPages && active.length > 0 && Date.now() < deadline; page++) {
      const declarations = active.map((i) => `$a${i}: String, $o${i}: [String!], $t${i}: [TagFilter!]!`).join(", ");
      const fields = active
        .map(
          (i) => `s${i}: transactions(first: ${SCAN_PAGE_SIZE}, after: $a${i}, sort: HEIGHT_DESC, owners: $o${i}, tags: $t${i}) {
    pageInfo { hasNextPage }
    edges { cursor node { id recipient tags { name value } } }
  }`,
        )
        .join("\n  ");
      const variables: Record<string, unknown> = {};
      for (const i of active) {
        variables[`a${i}`] = cursors[i];
        variables[`o${i}`] = sources[i]?.filter.owners;
        variables[`t${i}`] = sources[i]?.filter.tags;
      }
      const data = (
        await postGraphQLWithFailover<{ data?: Record<string, Connection | undefined> }>(
          gatewayUrl,
          `query (${declarations}) {\n  ${fields}\n}`,
          variables,
          fetchImpl,
          describe,
        )
      ).data;
      const next: number[] = [];
      for (const i of active) {
        const connection = data?.[`s${i}`];
        const edges = connection?.edges ?? [];
        const pick = sources[i]?.pick;
        for (const { node } of edges) {
          const id = pick ? pick(node) : node.id;
          if (id && ARWEAVE_ID.test(id)) ids[i]?.push(id);
        }
        if (connection?.pageInfo?.hasNextPage && edges.length > 0) {
          cursors[i] = edges[edges.length - 1]?.cursor;
          next.push(i);
        }
      }
      active = next;
    }
    return ids;
  };

  const fetchTags = async (ids: string[]): Promise<Map<string, Tag[]>> => {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += SCAN_PAGE_SIZE) batches.push(ids.slice(i, i + SCAN_PAGE_SIZE));
    const found = new Map<string, Tag[]>();
    const failures: unknown[] = [];
    await mapLimit(batches, concurrency, async (batch) => {
      if (Date.now() >= deadline) return;
      try {
        const connection = await query(DESCRIPTOR_QUERY, { ids: batch, first: SCAN_PAGE_SIZE });
        for (const { node } of connection?.edges ?? []) found.set(node.id, node.tags);
      } catch (error) {
        failures.push(error);
      }
    });
    // One failed batch must not discard the descriptors that did load.
    if (failures.length > 0 && found.size === 0) throw failures[0];
    return found;
  };

  return { scan, scanMany, fetchTags };
}
