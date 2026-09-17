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
 * Additional gateways to fall through to when the primary (the one a
 * caller passes as `gatewayUrl`, from `NetworkSettings.gatewayUrl` — the
 * single-gateway config surface every other read in this codebase already
 * uses) fails outright (network error, non-2xx, GraphQL `errors`). Ordered
 * by general reliability/uptime reputation, not configurable — this is
 * resilience underneath the existing single-gateway happy path, not a
 * second config surface. `arweave.net` itself is deliberately included
 * first in the merged list built by `gatewayCandidates` below even when a
 * caller's own `gatewayUrl` differs, since a caller-configured gateway
 * failing is exactly the case failover exists for.
 */
const FALLBACK_GATEWAYS: readonly string[] = ["https://arweave.net", "https://arweave-search.goldsky.com"];

function gatewayCandidates(primaryGatewayUrl: string): string[] {
  const primary = trimTrailingSlash(primaryGatewayUrl);
  const candidates = [primary, ...FALLBACK_GATEWAYS.map(trimTrailingSlash)];
  return [...new Set(candidates)];
}

/**
 * Posts `query`/`variables` to `{gateway}/graphql` for each candidate
 * gateway in order (primary first, then `FALLBACK_GATEWAYS`), returning
 * the first successful parsed response and falling through to the next
 * gateway on any failure (network error, non-2xx, or a GraphQL `errors`
 * array). Throws only if every candidate gateway fails, with the last
 * gateway's own error message — callers get the same failure shape as
 * before failover was added, just tried against more than one gateway
 * first.
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
 * as owner (sent) union recipient (received) — the two queries the
 * `activity` layer's merge logic combines with the local action log
 * (PRD's Activity feed rule: "one gateway GraphQL transactions query by
 * owner and recipient, most-recent-N").
 *
 * Pure: no `chrome.*`/window/document dependency, explicit `gatewayUrl`
 * and injectable `fetchImpl`. Falls through to `FALLBACK_GATEWAYS` if
 * `gatewayUrl` fails — see `postGraphQLWithFailover`.
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
    // A transaction returned by the gateway's GraphQL index has already
    // reached consensus in a block — this client has no way to observe
    // "failed" (Arweave doesn't fail transactions post-inclusion the way
    // a smart-contract call can), so every gateway-sourced entry is
    // reported "confirmed"; only the local optimistic log ever produces
    // "pending".
    status: "confirmed",
    address: type === "send" ? (node.recipient ?? "") : node.owner.address,
    amount: node.quantity.winston,
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
  };
}

/**
 * Minimal shape of the gateway's GraphQL response for an AO-transfer-tagged
 * transaction node — `quantity` here is deliberately typed as a raw string
 * (not `{ winston: string }`): AO message quantities are read from the
 * `Quantity` tag (an atomic-integer string in the token's own smallest
 * unit, per its resolved denomination), never from Arweave's own
 * `quantity.winston` field, which only ever reflects the tiny/zero AR
 * fee the message-send transaction itself carries.
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
 * One page of AO transfer activity for `address`, read from the SAME
 * gateway `/graphql` endpoint `queryActivityTransactions` uses — no
 * separate indexer — filtered by AO's own transfer-message tag
 * convention (`{name: "Action", values: ["Transfer"]}` +
 * `{name: "Recipient", values: [address]}`, matched case-insensitively
 * the same way `token-metadata.ts`'s `toTokenMetadata` already does,
 * since live gateway responses were found to lower-case AO's spawn tags
 * there and message tags follow the same convention).
 *
 * Only the recipient-side query is issued: an AO transfer message is a
 * single Data Item with exactly one recipient process/wallet named by its
 * `Recipient` tag, and `From-Process`/`owner` on that same message
 * identifies the sender — so one tag-filtered query recovers both "sent
 * to me" (`address` is `Recipient`) and, from the same edge set filtered
 * the other direction, "sent by me". This matches `queryActivityTransactions`'s
 * owner-union-recipient shape using AO's tag vocabulary instead of GraphQL's
 * native `owners`/`recipients` fields, which don't apply to a message
 * transaction's AO-level sender/recipient (those are tag-carried, not
 * transaction-native, for an AO transfer).
 *
 * Quantity is resolved via `token-metadata.ts`'s `queryTokenMetadata`
 * (through `resolveUnregisteredTokenMetadata`/`isRegisteredProcessId`,
 * `pricing/token-sources.ts`) against the process id the transfer message
 * was sent to (`node.recipient` when present, the AO process the transfer
 * targets) — resolved once per distinct process id per page, not once per
 * entry, to avoid a metadata lookup per transfer. A transfer whose process
 * id can't be resolved (metadata lookup failure) is still returned with
 * its raw `Quantity` tag value as `amount` and no `token` set, rather than
 * dropped — HONESTY: an unresolved token identity is surfaced as unlabeled
 * activity, never silently discarded.
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

  // `denominationByProcessId` confirms the resolved process id's
  // denomination is known — nothing here reformats `amount` against it
  // (every ActivityEntry producer keeps `amount` as a raw atomic-integer
  // string, matching `TokenBalance.quantity`'s own convention); a caller
  // that needs to display a human-scaled value resolves denomination the
  // same way `withUnregisteredMetadata` (reads.ts) already does for
  // balances, keyed off `token`.
  void denominationByProcessId;

  return {
    txId: node.id,
    type,
    // Same gateway-index-implies-confirmed reasoning as toActivityEntry —
    // failed-AO-transfer detection is `merge.ts`'s concern, not this
    // parser's; a transfer message the gateway indexed reached the AO
    // process, whether or not the process's own handler accepted it.
    status: "confirmed",
    address: type === "send" ? (node.recipient ?? "") : node.owner.address,
    // Plain atomic-integer string in the token's own smallest unit — NOT
    // `{winston}`-shaped.
    amount: quantity,
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
    token: processId,
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
