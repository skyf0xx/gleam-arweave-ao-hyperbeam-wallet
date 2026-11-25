import { L1_CANARY_PROCESS_ID, trimTrailingSlashes } from "../models/network";

export { trimTrailingSlashes as stripTrailingSlashes } from "../models/network";
import { readCappedDigits, readCappedText } from "./capped-body";
import { mapLimit } from "../models/concurrency";
import type { Tag } from "../models/tag";

export interface DiscoverHyperBeamPeersOptions {
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Pages (100 each) read per tag query. */
  maxPages?: number;
  /** Candidate nodes probed, newest first. */
  maxProbes?: number;
  concurrency?: number;
  /** Per-request timeout for each GraphQL page and probe. */
  timeoutMs?: number;
}

interface LocationNode {
  id: string;
  owner?: { address?: string } | null;
  block?: { timestamp?: number } | null;
  tags?: Tag[] | null;
}

interface LocationPage {
  data?: {
    transactions?: {
      pageInfo?: { hasNextPage?: boolean };
      edges?: { cursor: string; node: LocationNode }[];
    };
  };
}

const LOCATION_TAG_FILTERS = [
  [{ name: "Type", values: ["Location", "Scheduler-Location"] }],
  [{ name: "type", values: ["location"] }],
] as const;

const QUERY = `query($tags: [TagFilter!], $after: String) {
  transactions(tags: $tags, first: 100, after: $after, sort: HEIGHT_DESC) {
    pageInfo { hasNextPage }
    edges { cursor node { id owner { address } block { timestamp } tags { name value } } }
  }
}`;

// Hosts that only make sense on the publisher's own machine or network, or
// that are throwaway tunnels which rotate before anyone else could use them.
const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".example",
  ".ngrok.io",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.dev",
  ".loca.lt",
  ".sslip.io",
  ".nip.io",
];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** The bare https origin a location record's `Url` names, or null if it isn't a usable public node. */
export function normalizePeerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(trimTrailingSlashes(raw.trim()));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const host = url.hostname.toLowerCase();
  // A fully-qualified "localhost." or "x.local." would slip past every exact
  // and suffix check below, and no public node is announced that way.
  if (host.endsWith(".")) return null;
  if (host === "localhost" || host.startsWith("[")) return null;
  if (isPrivateIpv4(host)) return null;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) return null;
  if (host.startsWith("uri-did-ar-")) return null;
  return url.origin;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Probe answers are short — an Arweave address, or a slot number — so a
// probe response never needs more than this. A peer that serves more is
// not a usable probe answer, and reading it all would let any probed peer
// allocate unbounded memory in the worker.
const PROBE_RESPONSE_MAX_BYTES = 4096;

// A page is at most 100 location records, each a few tags.
const LOCATION_PAGE_MAX_BYTES = 1024 * 1024;

async function readLocationRecords(
  gatewayUrl: string,
  tags: (typeof LOCATION_TAG_FILTERS)[number],
  fetchImpl: typeof fetch,
  maxPages: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<LocationNode[]> {
  const nodes: LocationNode[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    try {
      const response = await fetchImpl(`${trimTrailingSlashes(gatewayUrl)}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { tags, after } }),
        signal: withTimeout(signal, timeoutMs),
      });
      if (!response.ok) break;
      const text = await readCappedText(response, LOCATION_PAGE_MAX_BYTES);
      if (text === null) break;
      const body = JSON.parse(text) as LocationPage;
      const edges = body.data?.transactions?.edges ?? [];
      for (const edge of edges) nodes.push(edge.node);
      if (!body.data?.transactions?.pageInfo?.hasNextPage || edges.length === 0) break;
      after = edges[edges.length - 1]!.cursor;
    } catch {
      break;
    }
  }
  return nodes;
}

async function answersAsNode(
  origin: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${origin}/~meta@1.0/info/address`, {
      signal: withTimeout(signal, timeoutMs),
    });
    if (response.status !== 200) return false;
    const text = await readCappedText(response, PROBE_RESPONSE_MAX_BYTES);
    return text !== null && text.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Public HyperBEAM nodes announced on-chain through location records
 * (`Type: Location | Scheduler-Location`, `type: location`), keeping each
 * owner's newest announcement and only nodes that answer
 * `/~meta@1.0/info/address`. Newest first. Never throws: any failure yields
 * fewer (or no) nodes.
 */
export async function discoverHyperBeamPeers({
  gatewayUrl,
  fetchImpl = fetch,
  signal,
  maxPages = 3,
  maxProbes = 40,
  concurrency = 6,
  timeoutMs = 8000,
}: DiscoverHyperBeamPeersOptions): Promise<string[]> {
  try {
    const pages = await Promise.all(
      LOCATION_TAG_FILTERS.map((tags) => readLocationRecords(gatewayUrl, tags, fetchImpl, maxPages, timeoutMs, signal)),
    );

    // An owner may re-announce many times; only its latest address counts.
    // Unconfirmed records have no block yet and are the newest of all.
    const newestByOwner = new Map<string, { url: string; at: number }>();
    for (const node of pages.flat()) {
      const raw = node.tags?.find((tag) => tag.name === "Url" || tag.name === "url")?.value;
      if (!raw) continue;
      const url = normalizePeerUrl(raw);
      if (!url) continue;
      const owner = node.owner?.address ?? node.id;
      const at = node.block?.timestamp ?? Number.MAX_SAFE_INTEGER;
      const current = newestByOwner.get(owner);
      if (!current || at > current.at) newestByOwner.set(owner, { url, at });
    }

    const candidates: string[] = [];
    for (const { url } of [...newestByOwner.values()].sort((a, b) => b.at - a.at)) {
      if (!candidates.includes(url)) candidates.push(url);
      if (candidates.length >= maxProbes) break;
    }

    const alive = await mapLimit(
      candidates,
      Math.max(1, concurrency),
      (candidate) => answersAsNode(candidate, fetchImpl, timeoutMs, signal),
      signal,
    );
    return candidates.filter((_, index) => alive[index]);
  } catch {
    return [];
  }
}

export interface FindL1TokenNodesOptions {
  candidates: readonly string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * The `candidates` that compute `arweave-scheduler@1.0` processes: those
 * that answer `L1_CANARY_PROCESS_ID`'s current slot with a number. In the
 * order given. Never throws.
 */
export async function findL1TokenNodes({
  candidates,
  fetchImpl = fetch,
  signal,
  concurrency = 6,
  timeoutMs = 8000,
}: FindL1TokenNodesOptions): Promise<string[]> {
  const urls = [...new Set(candidates.map(trimTrailingSlashes))];
  const serves = await mapLimit(
    urls,
    Math.max(1, concurrency),
    async (url) => {
      try {
        const response = await fetchImpl(`${url}/${L1_CANARY_PROCESS_ID}~process@1.0/slot/current`, {
          signal: withTimeout(signal, timeoutMs),
        });
        return response.ok && (await readCappedDigits(response, PROBE_RESPONSE_MAX_BYTES)) !== null;
      } catch {
        return false;
      }
    },
    signal,
  );
  return urls.filter((_, index) => serves[index]);
}
