import { classifyAsset } from "../ao/asset-scan";
import type { TokenMetadata, TokenTransport } from "../models/token-metadata";

/**
 * A process id is itself the spawning transaction's id, so this queries
 * by `ids` rather than `owners`/`recipients`.
 */
interface GraphQLTag {
  name: string;
  value: string;
}

interface GraphQLTransactionsByIdResponse {
  data?: {
    transactions?: {
      edges: Array<{ node: { id: string; tags: GraphQLTag[] } }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const LOGO_TX_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where to load a token's logo from: the `logo` tag is an Arweave
 * transaction id, served by the user's own https gateway. Anything else
 * (a URL, a data URI, a malformed id) is the token's attempt to point the
 * popup somewhere else, so it yields `null`.
 */
export function tokenLogoUrl(gatewayUrl: string, logo: string | null): string | null {
  if (logo === null || !LOGO_TX_ID.test(logo)) return null;
  try {
    const gateway = new URL(gatewayUrl);
    return gateway.protocol === "https:" ? `${gateway.origin}/${logo}` : null;
  } catch {
    return null;
  }
}

/**
 * Token metadata read directly from an AO process's spawn tags via the
 * gateway's GraphQL endpoint — no dryrun/CU round-trip. Spawn tags are
 * immutable once a process exists, so a resolved result is cacheable
 * indefinitely by the caller.
 *
 * Tag names are matched case-insensitively: live gateways return them
 * lower-cased, not the title-cased form AO's token-spec docs show as
 * examples. A field the spawn tags didn't carry is `null`, never a
 * fabricated default. Throws if the gateway request fails or no
 * transaction with that id exists.
 */
export async function queryTokenMetadata(
  processId: string,
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenMetadata> {
  const query = `
    query ($ids: [ID!]!) {
      transactions(ids: $ids) {
        edges {
          node {
            id
            tags { name value }
          }
        }
      }
    }
  `;

  const url = `${trimTrailingSlash(gatewayUrl)}/graphql`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { ids: [processId] } }),
  });

  if (!response.ok) {
    throw new Error(
      `Gateway GraphQL metadata query for process "${processId}" failed (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as GraphQLTransactionsByIdResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `Gateway GraphQL metadata query for process "${processId}" returned errors: ${body.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  const edge = body.data?.transactions?.edges[0];

  if (!edge) {
    throw new Error(
      `No spawn transaction found for process "${processId}" — cannot resolve token metadata.`,
    );
  }

  return tokenMetadataFromTags(processId, edge.node.tags);
}

/** `arweave-scheduler@1.0` is the one scheduler that takes messages as L1 transactions. */
export function transportFromTags(tags: GraphQLTag[]): TokenTransport {
  const scheduler = tags.find((tag) => tag.name.toLowerCase() === "scheduler-device")?.value;
  return scheduler === "arweave-scheduler@1.0" ? "l1" : "mu";
}

export function tokenMetadataFromTags(processId: string, tags: GraphQLTag[]): TokenMetadata {
  const tagValue = (name: string): string | null =>
    tags.find((tag) => tag.name.toLowerCase() === name)?.value ?? null;

  const rawDenomination = tagValue("denomination");
  const denomination =
    rawDenomination !== null && /^\d+$/.test(rawDenomination) ? Number(rawDenomination) : null;

  return {
    processId,
    transport: transportFromTags(tags),
    assetClass: classifyAsset(tags),
    denomination,
    ticker: tagValue("ticker"),
    name: tagValue("name"),
    description: tagValue("description"),
    logo: tagValue("logo"),
    totalSupply: tagValue("total-supply"),
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
