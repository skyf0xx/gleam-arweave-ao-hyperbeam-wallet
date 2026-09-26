import type { ActivityEntry } from "../models/activity";
import { isRegisteredProcessId, resolveUnregisteredTokenMetadata } from "../pricing/token-sources";

/**
 * Minimal shape of the gateway's GraphQL transaction connection response
 * this client actually reads — not the full arweave-graphql schema.
 */
interface GraphQLTag {
  name: string;
  value: string;
}

interface GraphQLTransactionNode {
  id: string;
  owner: { address: string };
  recipient: string | null;
  quantity: { winston: string };
  tags: GraphQLTag[];
  block: { timestamp: number } | null;
}

interface GraphQLTransactionsResponse {
  data?: {
    transactions?: {
      edges: Array<{ cursor: string; node: GraphQLTransactionNode }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Additional gateways to fall through to when the primary fails outright
 * (network error, non-2xx, GraphQL `errors`). Not configurable — this is
 * resilience underneath the single-gateway config surface, not a second
 * config surface. Exported so `wxt.config.ts` grants each a static host
 * permission.
 */
export const FALLBACK_GATEWAYS: readonly string[] = ["https://arweave.net", "https://arweave-search.goldsky.com"];

function gatewayCandidates(primaryGatewayUrl: string): string[] {
  const primary = trimTrailingSlash(primaryGatewayUrl);
  const candidates = [primary, ...FALLBACK_GATEWAYS.map(trimTrailingSlash)];
  return [...new Set(candidates)];
}

/**
 * Posts `query`/`variables` to `{gateway}/graphql` for each candidate
 * gateway in order (primary first, then `FALLBACK_GATEWAYS`), returning
 * the first successful parsed response. Throws only if every candidate
 * fails, with the last gateway's error message.
 */
async function postGraphQLWithFailover<T>(
  primaryGatewayUrl: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
  describeFailure: (gatewayUrl: string, detail: string) => string,
): Promise<T> {
  const candidates = gatewayCandidates(primaryGatewayUrl);
  let lastError: Error | null = null;

  for (const gatewayUrl of candidates) {
    try {
      const url = `${gatewayUrl}/graphql`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(describeFailure(gatewayUrl, `HTTP ${response.status}`));
      }

      const body = (await response.json()) as { errors?: Array<{ message: string }> } & T;

      if (body.errors && body.errors.length > 0) {
        throw new Error(
          describeFailure(gatewayUrl, body.errors.map((error) => error.message).join("; ")),
        );
      }

      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Gateway GraphQL query failed against every candidate gateway.");
}

/**
 * One page of gateway GraphQL transaction results for `address`, queried
 * as owner (sent) union recipient (received) — combined by the
 * `activity` layer's merge logic with the local action log. Falls
 * through to `FALLBACK_GATEWAYS` if `gatewayUrl` fails — see
 * `postGraphQLWithFailover`.
 */
export async function queryActivityTransactions(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const query = `
    query ($address: [String!], $first: Int!) {
      transactions(owners: $address, recipients: $address, first: $first, sort: HEIGHT_DESC) {
        edges {
          cursor
          node {
            id
            owner { address }
            recipient
            quantity { winston }
            tags { name value }
            block { timestamp }
          }
        }
      }
    }
  `;

  const body = await postGraphQLWithFailover<GraphQLTransactionsResponse>(
    gatewayUrl,
    query,
    { address: [address], first: limit },
    fetchImpl,
    (gw, detail) => `Gateway GraphQL query for "${address}" against "${gw}" failed: ${detail}`,
  );

  const edges = body.data?.transactions?.edges ?? [];

  return edges.map(({ node }) => toActivityEntry(node, address));
}

function toActivityEntry(node: GraphQLTransactionNode, address: string): ActivityEntry {
  const type = node.owner.address === address ? "send" : "receive";
  return {
    txId: node.id,
    type,
    // Gateway-indexed means already included in a block; Arweave has no
    // post-inclusion failure state, so this is always "confirmed" — only
    // the local optimistic log ever produces "pending".
    status: "confirmed",
    address: type === "send" ? (node.recipient ?? "") : node.owner.address,
    amount: node.quantity.winston,
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
  };
}

/**
 * AO message quantities are read from the `Quantity` tag (an
 * atomic-integer string in the token's own smallest unit), never from
 * Arweave's `quantity.winston` field, which only reflects the tiny/zero
 * AR fee the message-send transaction itself carries.
 */
interface GraphQLAoTransferNode {
  id: string;
  owner: { address: string };
  recipient: string | null;
  tags: GraphQLTag[];
  block: { timestamp: number } | null;
}

interface GraphQLAoTransferResponse {
  data?: {
    transactions?: {
      edges: Array<{ cursor: string; node: GraphQLAoTransferNode }>;
    };
  };
  errors?: Array<{ message: string }>;
}

function tagValue(tags: GraphQLTag[], name: string): string | null {
  return tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/**
 * One page of AO transfer activity for `address`, read from the same
 * gateway `/graphql` endpoint `queryActivityTransactions` uses, filtered
 * by AO's transfer-message tag convention. Only the recipient-side query
 * is issued: an AO transfer message has exactly one recipient named by
 * its `Recipient` tag, and `owner` on that same message identifies the
 * sender, so one tag-filtered query recovers both directions.
 *
 * Denomination is resolved once per distinct process id per page (not
 * once per entry) to avoid a metadata lookup per transfer. A transfer
 * whose process id can't be resolved is still returned with its raw
 * `Quantity` tag value as `amount` and no `token` set, rather than
 * dropped.
 */
export async function queryAoTransferActivity(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const query = `
    query ($recipients: [String!], $first: Int!) {
      transactions(recipients: $recipients, first: $first, sort: HEIGHT_DESC, tags: [
        { name: "Action", values: ["Transfer"] }
      ]) {
        edges {
          cursor
          node {
            id
            owner { address }
            recipient
            tags { name value }
            block { timestamp }
          }
        }
      }
    }
  `;

  const body = await postGraphQLWithFailover<GraphQLAoTransferResponse>(
    gatewayUrl,
    query,
    { recipients: [address], first: limit },
    fetchImpl,
    (gw, detail) => `Gateway AO-transfer GraphQL query for "${address}" against "${gw}" failed: ${detail}`,
  );

  const edges = body.data?.transactions?.edges ?? [];

  const processIds = new Set(edges.map(({ node }) => node.recipient).filter((id): id is string => id !== null));
  const denominationByProcessId = new Map<string, number>();
  await Promise.all(
    [...processIds].map(async (processId) => {
      if (isRegisteredProcessId(processId)) return;
      const metadata = await resolveUnregisteredTokenMetadata(processId, gatewayUrl, fetchImpl);
      if (metadata?.denomination !== null && metadata?.denomination !== undefined) {
        denominationByProcessId.set(processId, metadata.denomination);
      }
    }),
  );

  return edges.map(({ node }) => toAoActivityEntry(node, address, denominationByProcessId));
}

function toAoActivityEntry(
  node: GraphQLAoTransferNode,
  address: string,
  denominationByProcessId: Map<string, number>,
): ActivityEntry {
  const type = node.owner.address === address ? "send" : "receive";
  const processId = node.recipient;
  const quantity = tagValue(node.tags, "Quantity") ?? "0";

  // amount stays a raw atomic-integer string here, matching every other
  // ActivityEntry producer; a caller needing a human-scaled value
  // resolves denomination itself (see withUnregisteredMetadata in reads.ts).
  void denominationByProcessId;

  return {
    txId: node.id,
    type,
    // Reached the AO process, whether or not its handler accepted it;
    // failed-transfer detection is merge.ts's concern, not this parser's.
    status: "confirmed",
    address: type === "send" ? (node.recipient ?? "") : node.owner.address,
    amount: quantity,
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
    token: processId,
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
