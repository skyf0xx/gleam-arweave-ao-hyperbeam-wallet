import type { ActivityEntry } from "../models/activity";

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
 * One page of gateway GraphQL transaction results for `address`, queried
 * as owner (sent) union recipient (received) — the two queries the
 * `activity` layer's merge logic combines with the local action log
 * (PRD's Activity feed rule: "one gateway GraphQL transactions query by
 * owner and recipient, most-recent-N").
 *
 * Pure: no `chrome.*`/window/document dependency, explicit `gatewayUrl`
 * and injectable `fetchImpl`.
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

  const url = `${trimTrailingSlash(gatewayUrl)}/graphql`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { address: [address], first: limit } }),
  });

  if (!response.ok) {
    throw new Error(
      `Gateway GraphQL query for "${address}" failed (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as GraphQLTransactionsResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `Gateway GraphQL query for "${address}" returned errors: ${body.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

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

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
