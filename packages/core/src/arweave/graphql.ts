import { z } from "zod";
import type { ActivityEntry } from "../models/activity";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "../ao/collectible-transfer";
import { L1_ACTIVATION_WINSTON } from "../ao/l1-transfer";
import { userErrorMessage } from "../models/user-errors";
import { isArweaveId } from "../models/arweave-id";
import { tagValue, type Tag } from "../models/tag";
import { trimTrailingSlashes } from "../models/network";
import { blockSchema, graphqlErrorsSchema, nullable, tagSchema, transactionsReply } from "./graphql-schema";

/**
 * The fields of the gateway's GraphQL transaction node this client
 * actually reads — not the full arweave-graphql schema.
 */
const activityNodeSchema = z.object({
  id: z.string(),
  owner: z.object({ address: z.string() }),
  recipient: nullable(z.string()),
  // An integer string: a reply with anything else is refused, so the next gateway is asked.
  quantity: z.object({ winston: z.string().regex(/^\d*$/) }),
  tags: z.array(tagSchema),
  // arweave.net sends `size: null` for some AO messages.
  data: nullable(z.object({ size: nullable(z.string()) })),
  block: blockSchema({ timestamp: z.number() }),
});
type GraphQLTransactionNode = z.output<typeof activityNodeSchema>;

const activityReplySchema = transactionsReply(activityNodeSchema);

/**
 * Additional gateways to fall through to when the primary fails outright
 * (network error, non-2xx, GraphQL `errors`). Not configurable — this is
 * resilience underneath the single-gateway config surface, not a second
 * config surface. Exported so `wxt.config.ts` grants each a static host
 * permission.
 */
export const FALLBACK_GATEWAYS: readonly string[] = ["https://arweave.net", "https://arweave-search.goldsky.com"];

/** Per gateway, so one that never answers falls through to the next candidate. */
const GRAPHQL_TIMEOUT_MS = 10_000;

function gatewayCandidates(primaryGatewayUrl: string): string[] {
  const primary = trimTrailingSlashes(primaryGatewayUrl);
  const candidates = [primary, ...FALLBACK_GATEWAYS.map(trimTrailingSlashes)];
  return [...new Set(candidates)];
}

/**
 * Posts `query`/`variables` to `{gatewayUrl}/graphql` and returns the parsed
 * response. A non-2xx status or GraphQL `errors` throw the text
 * `describeFailure` gives for them; a failed fetch throws as it is.
 */
export async function postGraphQL<S extends z.ZodType>(
  gatewayUrl: string,
  query: string,
  variables: Record<string, unknown>,
  schema: S,
  fetchImpl: typeof fetch,
  describeFailure: (gatewayUrl: string, detail: string, kind: "http" | "graphql") => string,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  const response = await fetchImpl(`${gatewayUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(describeFailure(gatewayUrl, `HTTP ${response.status}`, "http"));
  }

  const json: unknown = await response.json();
  const errors = graphqlErrorsSchema.safeParse(json);

  if (errors.success && errors.data.errors && errors.data.errors.length > 0) {
    throw new Error(
      describeFailure(gatewayUrl, errors.data.errors.map((error) => error.message).join("; "), "graphql"),
    );
  }

  const body = schema.safeParse(json);
  if (!body.success) throw new Error(describeFailure(gatewayUrl, "unexpected reply shape", "graphql"));
  return body.data;
}

/**
 * Posts `query`/`variables` to `{gateway}/graphql` for each candidate
 * gateway in order (primary first, then `FALLBACK_GATEWAYS`), returning
 * the first successful parsed response. Throws only if every candidate
 * fails, with the last gateway's error message.
 */
export async function postGraphQLWithFailover<S extends z.ZodType>(
  primaryGatewayUrl: string,
  query: string,
  variables: Record<string, unknown>,
  schema: S,
  fetchImpl: typeof fetch,
  describeFailure: (gatewayUrl: string, detail: string) => string,
): Promise<z.output<S>> {
  const candidates = gatewayCandidates(primaryGatewayUrl);
  let lastError: Error | null = null;

  for (const gatewayUrl of candidates) {
    try {
      return await postGraphQL(
        gatewayUrl,
        query,
        variables,
        schema,
        fetchImpl,
        describeFailure,
        AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(userErrorMessage("gatewayAllFailed"));
}

/** The fields every activity entry takes from its transaction, whatever it turns out to be. */
function entryBase(node: { id: string; tags: Tag[]; block: { timestamp: number } | null }) {
  return {
    txId: node.id,
    tags: node.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    timestamp: node.block ? node.block.timestamp * 1000 : 0,
  };
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
      data { size }
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
    userErrorMessage("gatewayQueryFailed", { address, gateway: gw, detail });
  const run = async (query: string) => {
    const body = await postGraphQLWithFailover(
      gatewayUrl,
      query,
      { address: [address], first: limit },
      activityReplySchema,
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
  // shows up on both sides (kept as the send). The second copy of a mined
  // transaction can come back with no block, so it never replaces one
  // that has a block.
  const byId = new Map<string, ActivityEntry>();
  const keep = (node: GraphQLTransactionNode) => {
    if (!node.block && byId.get(node.id)?.status === "confirmed") return;
    byId.set(node.id, toActivityEntry(node, address));
  };
  for (const node of received) {
    if (node.owner.address !== address && BigInt(node.quantity.winston || "0") > 0n) keep(node);
  }
  for (const node of sent) {
    if (node.owner.address === address) keep(node);
  }
  return [...byId.values()];
}

function isAoMessage(tags: Tag[]): boolean {
  return tagValue(tags, "Data-Protocol", { anyCase: true })?.toLowerCase() === "ao";
}

function toActivityEntry(node: GraphQLTransactionNode, address: string): ActivityEntry {
  const sent = node.owner.address === address;
  // A transaction the wallet signed with no target and no AR is a data
  // upload, which the local log records as "upload".
  const isUpload = sent && !node.recipient && BigInt(node.quantity.winston || "0") === 0n;
  const type = isUpload ? "upload" : sent ? "send" : "receive";
  if (sent && node.recipient && isSwapOrder(node.tags)) {
    return {
      ...entryBase(node),
      type: "send",
      status: node.block ? "confirmed" : "pending",
      address: node.recipient,
      amount: null,
      swap: { process: node.recipient },
    };
  }
  const l1Transfer = sent && node.recipient ? l1TokenTransferOf(node) : null;
  if (l1Transfer !== null && node.recipient) return toL1TransferEntry(node, "send", l1Transfer.recipient, l1Transfer.quantity, node.recipient);
  return {
    ...entryBase(node),
    type,
    // No block yet means accepted but not mined (or its bundle not yet
    // mined). Arweave has no failure state after a block includes it.
    status: node.block ? "confirmed" : "pending",
    address: isUpload ? address : sent ? (node.recipient ?? "") : node.owner.address,
    amount: isUpload ? null : node.quantity.winston,
    ...(isUpload && node.data?.size && /^\d+$/.test(node.data.size) ? { dataSize: node.data.size } : {}),
  };
}

/**
 * A market order the way permawebOS reads one: the `register-interest`
 * action and a transaction-id `order-id`. Both are the signer's own tags, so this says
 * what the wallet asked for, not that anything was bought.
 */
function isSwapOrder(tags: Tag[]): boolean {
  const exact = (name: string) => tagValue(tags, name);
  return exact("action") === "register-interest" && isArweaveId(exact("order-id") ?? "");
}

/**
 * The recipient and quantity of an L1 token transfer (`ao/l1-transfer.ts`):
 * a transaction to the token process, carrying no AR or the activation
 * winston, whose lowercase tags name the transfer. Other wallets add their own tags, so extra tags are
 * allowed. Only says a transfer was asked for; the token process alone
 * decides whether it moved.
 */
function l1TokenTransferOf(node: { quantity?: { winston: string }; tags: Tag[] }): { recipient: string; quantity: string } | null {
  const value = node.quantity?.winston || "0";
  if (value !== "0" && value !== L1_ACTIVATION_WINSTON) return null;
  const exact = (name: string) => tagValue(node.tags, name);
  const recipient = exact("recipient");
  const quantity = exact("quantity");
  if (exact("action") !== "transfer" || quantity === undefined || !/^[1-9]\d*$/.test(quantity)) return null;
  return recipient !== undefined && isArweaveId(recipient) ? { recipient, quantity } : null;
}

/**
 * A quantity of exactly 1 is read as a collectible, the common case. A
 * fungible token sent one atomic unit at a time looks the same here, so
 * the caller re-reads such an entry once it knows the process's class
 * from its spawn tags.
 */
function toL1TransferEntry(
  node: { id: string; tags: Tag[]; block: { timestamp: number } | null },
  type: "send",
  counterparty: string,
  quantity: string,
  processId: string,
): ActivityEntry {
  const base = {
    ...entryBase(node),
    type,
    status: node.block ? ("confirmed" as const) : ("pending" as const),
    address: counterparty,
  };
  return quantity === COLLECTIBLE_TRANSFER_QUANTITY
    ? { ...base, amount: null, collectible: { id: processId } }
    : { ...base, amount: quantity, token: processId };
}

/**
 * L1 token transfers to `address` on `arweave-scheduler@1.0` tokens: a
 * zero-AR transaction to the token process whose `recipient` tag names
 * `address`. These tokens push no Credit-Notice, so the transfer request
 * is the only on-chain record of a receive.
 *
 * Every field is the signer's claim. Anyone can tag a transaction to any
 * process with any quantity, so each entry is marked `unverified`, is
 * always token-shaped (never a collectible), and the caller must keep
 * only entries whose `token` is one the user already lists.
 */
export async function queryL1TokenReceipts(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const body = await postGraphQLWithFailover(
    gatewayUrl,
    `query ($address: [String!]!, $first: Int!) {
      transactions(first: $first, sort: HEIGHT_DESC, tags: [
        { name: "action", values: ["transfer"] },
        { name: "recipient", values: $address }
      ]) { ${TRANSACTION_FIELDS} }
    }`,
    { address: [address], first: limit },
    activityReplySchema,
    fetchImpl,
    (gw, detail) => userErrorMessage("gatewayReceiptQueryFailed", { address, gateway: gw, detail }),
  );
  const byId = new Map<string, ActivityEntry>();
  for (const { node } of body.data?.transactions?.edges ?? []) {
    if (!node.recipient || node.owner.address === address) continue;
    // Gateways list a mined transaction a second time with no block.
    if (!node.block && byId.has(node.id)) continue;
    const transfer = l1TokenTransferOf(node);
    if (transfer === null || transfer.recipient !== address) continue;
    byId.set(node.id, {
      ...entryBase(node),
      type: "receive",
      status: node.block ? "confirmed" : "pending",
      address: node.owner.address,
      amount: transfer.quantity,
      token: node.recipient,
      unverified: true,
    });
  }
  return [...byId.values()];
}

/** The block height of each of `ids` that has been mined. */
export async function queryBlockHeights(
  ids: string[],
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const heights = new Map<string, number>();
  // Doubled below because of the unmined duplicates, and gateways cap a page at 100.
  const lookup = [...new Set(ids)].slice(0, 50);
  if (lookup.length === 0) return heights;
  const body = await postGraphQLWithFailover(
    gatewayUrl,
    `query ($ids: [ID!]!, $first: Int!) { transactions(ids: $ids, first: $first) { edges { node { id block { height } } } } }`,
    { ids: lookup, first: lookup.length * 2 },
    transactionsReply(z.object({ id: z.string(), block: blockSchema({ height: z.number() }) })),
    fetchImpl,
    (gw, detail) => userErrorMessage("gatewayBlockQueryFailed", { gateway: gw, detail }),
  );
  for (const { node } of body.data?.transactions?.edges ?? []) {
    if (node.block) heights.set(node.id, node.block.height);
  }
  return heights;
}

/**
 * AO message quantities are read from the `Quantity` tag (an
 * atomic-integer string in the token's own smallest unit), never from
 * Arweave's `quantity.winston` field, which only reflects the tiny/zero
 * AR fee the message-send transaction itself carries.
 */
const aoTransferNodeSchema = z.object({
  id: z.string(),
  owner: z.object({ address: z.string() }),
  recipient: nullable(z.string()),
  tags: z.array(tagSchema),
  block: blockSchema({ timestamp: z.number() }),
});
type GraphQLAoTransferNode = z.output<typeof aoTransferNodeSchema>;

const aoTransferReplySchema = transactionsReply(aoTransferNodeSchema);

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
 * Wallets of the AO messenger units (MUs) that sign the messages a
 * process pushes from its outbox, Credit-Notices included: `fcoN…` on
 * legacynet until mid-2026, `6qOD…` since. The tags of a data item are
 * whatever its signer wrote, so anyone can sign a `Credit-Notice` with a
 * made-up `From-Process` and `Quantity`. The signer is the one part a
 * forger cannot fake, which makes it the check that a notice came out of
 * a real process. A new MU wallet must be added here or its receives
 * disappear from the feed.
 */
export const AO_MU_SIGNERS: readonly string[] = [
  "fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY",
  "6qOD-VYFZBKwYtrOm1Keh2ETif7SDUPAPx-UEu4qlR4",
];

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
 *   it is not used as the receive. Only notices signed by an
 *   `AO_MU_SIGNERS` wallet count.
 */
export async function queryAoTransferActivity(
  address: string,
  gatewayUrl: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityEntry[]> {
  const describe = (gw: string, detail: string) =>
    `Gateway AO-transfer GraphQL query for "${address}" against "${gw}" failed: ${detail}`;
  const run = async (query: string, variables: Record<string, unknown> = {}) => {
    const body = await postGraphQLWithFailover(
      gatewayUrl,
      query,
      { address: [address], first: limit, ...variables },
      aoTransferReplySchema,
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
    run(`query ($address: [String!], $signers: [String!], $first: Int!) {
      transactions(recipients: $address, owners: $signers, first: $first, sort: HEIGHT_DESC, tags: [
        { name: "Data-Protocol", values: ["ao"] },
        { name: "Action", values: ["Credit-Notice"] }
      ]) { ${AO_TRANSFER_FIELDS} }
    }`, { signers: AO_MU_SIGNERS }),
  ]);

  const byId = new Map<string, ActivityEntry>();
  for (const node of sent) {
    if (node.owner.address === address) byId.set(node.id, toAoSendEntry(node));
  }
  for (const node of received) {
    // Checked again here so a gateway that ignores `owners` cannot let a
    // forged notice through.
    if (!AO_MU_SIGNERS.includes(node.owner.address)) continue;
    const entry = toAoReceiveEntry(node);
    if (entry) byId.set(node.id, entry);
  }
  return [...byId.values()];
}

function toAoSendEntry(node: GraphQLAoTransferNode): ActivityEntry {
  return {
    ...entryBase(node),
    type: "send",
    // Reached the AO process, whether or not its handler accepted it;
    // failed-transfer detection is merge.ts's concern, not this parser's.
    status: "confirmed",
    address: tagValue(node.tags, "Recipient", { anyCase: true }) ?? "",
    amount: tagValue(node.tags, "Quantity", { anyCase: true }) ?? "0",
    token: node.recipient,
  };
}

function toAoReceiveEntry(node: GraphQLAoTransferNode): ActivityEntry | null {
  const token = tagValue(node.tags, "From-Process", { anyCase: true });
  if (!token) return null;
  return {
    ...entryBase(node),
    type: "receive",
    // A Credit-Notice exists only once the token process has executed the
    // transfer.
    status: "confirmed",
    address: tagValue(node.tags, "Sender", { anyCase: true }) ?? "",
    amount: tagValue(node.tags, "Quantity", { anyCase: true }) ?? "0",
    token,
  };
}
