import type { TokenMetadata } from "../models/token-metadata";

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

  return toTokenMetadata(processId, edge.node.tags);
}

function toTokenMetadata(processId: string, tags: GraphQLTag[]): TokenMetadata {
  const tagValue = (name: string): string | null =>
    tags.find((tag) => tag.name.toLowerCase() === name)?.value ?? null;

  const rawDenomination = tagValue("denomination");
  const denomination =
    rawDenomination !== null && /^\d+$/.test(rawDenomination) ? Number(rawDenomination) : null;

  return {
    processId,
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
