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

const TRANSACTION_FIELDS = `
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
`;

/**
 * One page of AR activity for `address`: what it sent, uploaded and
 * received. The gateway ANDs `owners` with `recipients`, so the two
 * sides are separate queries. AO messages are left to
 * `queryAoTransferActivity`, and a zero-AR transaction to `address` (an
 * AO notice, a data item) is not a receive. Falls through to
 * `FALLBACK_GATEWAYS` if `gatewayUrl` fails — see
 * `postGraphQLWithFailover`.
 */
export async function queryActivityTransactions(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const describe = (gw: string, detail: string) =>
    `Gateway GraphQL query for "${address}" against "${gw}" failed: ${detail}`;
  const run = async (query: string) => {
    const body = await postGraphQLWithFailover<GraphQLTransactionsResponse>(
      gatewayUrl,
      query,
      { address: [address], first: limit },
      fetchImpl,
      describe,
    );
    return (body.data?.transactions?.edges ?? []).map(({ node }) => node).filter((node) => !isAoMessage(node.tags));
  };

  const [sent, received] = await Promise.all([
    run(`query ($address: [String!], $first: Int!) {
      transactions(owners: $address, first: $first, sort: HEIGHT_DESC) { ${TRANSACTION_FIELDS} }
    }`),
    run(`query ($address: [String!], $first: Int!) {
      transactions(recipients: $address, first: $first, sort: HEIGHT_DESC) { ${TRANSACTION_FIELDS} }
    }`),
  ]);

  // Keyed by id: gateways can return the same node twice, and a self-send
  // shows up on both sides (kept as the send).
  const byId = new Map<string, ActivityEntry>();
  for (const node of received) {
    if (node.owner.address !== address && BigInt(node.quantity.winston || "0") > 0n) {
      byId.set(node.id, toActivityEntry(node, address));
    }
  }
  for (const node of sent) {
    if (node.owner.address === address) byId.set(node.id, toActivityEntry(node, address));
  }
  return [...byId.values()];
}

function isAoMessage(tags: GraphQLTag[]): boolean {
  return tagValue(tags, "Data-Protocol")?.toLowerCase() === "ao";
}

function toActivityEntry(node: GraphQLTransactionNode, address: string): ActivityEntry {
  const sent = node.owner.address === address;
  // A transaction the wallet signed with no target and no AR is a data
  // upload, which the local log records as "upload".
  const isUpload = sent && !node.recipient && BigInt(node.quantity.winston || "0") === 0n;
  const type = isUpload ? "upload" : sent ? "send" : "receive";
  return {
    txId: node.id,
    type,
    // No block yet means accepted but not mined (or its bundle not yet
    // mined). Arweave has no failure state after a block includes it.
    status: node.block ? "confirmed" : "pending",
    address: isUpload ? address : sent ? (node.recipient ?? "") : node.owner.address,
    amount: isUpload ? null : node.quantity.winston,
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

const AO_TRANSFER_FIELDS = `
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
`;

/**
 * One page of AO token activity for `address`, from the same gateway
 * `/graphql` endpoint `queryActivityTransactions` uses. Two queries:
 *
 * - Sends are the `Transfer` messages `address` signed. Their target
 *   (`recipient`) is the token process; the payee is the `Recipient` tag.
 * - Receives are the `Credit-Notice` messages a token process pushes to
 *   `address` once a transfer executes. The payer is the `Sender` tag and
 *   the token is `From-Process`. A `Transfer` naming `address` in its
 *   `Recipient` tag is only a request the process may still reject, so
 *   it is not used as the receive.
 */
export async function queryAoTransferActivity(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const describe = (gw: string, detail: string) =>
    `Gateway AO-transfer GraphQL query for "${address}" against "${gw}" failed: ${detail}`;
  const run = async (query: string) => {
    const body = await postGraphQLWithFailover<GraphQLAoTransferResponse>(
      gatewayUrl,
      query,
      { address: [address], first: limit },
      fetchImpl,
      describe,
    );
    return (body.data?.transactions?.edges ?? []).map(({ node }) => node);
  };

  const [sent, received] = await Promise.all([
    run(`query ($address: [String!], $first: Int!) {
      transactions(owners: $address, first: $first, sort: HEIGHT_DESC, tags: [
        { name: "Data-Protocol", values: ["ao"] },
        { name: "Action", values: ["Transfer"] }
      ]) { ${AO_TRANSFER_FIELDS} }
    }`),
    run(`query ($address: [String!], $first: Int!) {
      transactions(recipients: $address, first: $first, sort: HEIGHT_DESC, tags: [
        { name: "Data-Protocol", values: ["ao"] },
        { name: "Action", values: ["Credit-Notice"] }
      ]) { ${AO_TRANSFER_FIELDS} }
    }`),
  ]);

  const byId = new Map<string, ActivityEntry>();
  for (const node of sent) {
    if (node.owner.address === address) byId.set(node.id, toAoSendEntry(node));
  }
  for (const node of received) {
    const entry = toAoReceiveEntry(node);
    if (entry) byId.set(node.id, entry);
  }
  return [...byId.values()];
}

function toAoSendEntry(node: GraphQLAoTransferNode): ActivityEntry {
  return {
    txId: node.id,
    type: "send",
    // Reached the AO process, whether or not its handler accepted it;
    // failed-transfer detection is merge.ts's concern, not this parser's.
    status: "confirmed",
    address: tagValue(node.tags, "Recipient") ?? "",
    amount: tagValue(node.tags, "Quantity") ?? "0",
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
    token: node.recipient,
  };
}

function toAoReceiveEntry(node: GraphQLAoTransferNode): ActivityEntry | null {
  const token = tagValue(node.tags, "From-Process");
  if (!token) return null;
  return {
    txId: node.id,
    type: "receive",
    // A Credit-Notice exists only once the token process has executed the
    // transfer.
    status: "confirmed",
    address: tagValue(node.tags, "Sender") ?? "",
    amount: tagValue(node.tags, "Quantity") ?? "0",
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
    token,
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
