/** The name a site sorts by: its host without a leading `www.`. */
function sortName(url: string): string {
  return new URL(url).host.replace(/^www\./, "");
}

/**
 * The built-in dApps, hardcoded so no server can change the list, and
 * sorted here so an entry can be added anywhere.
 */
export const BUILT_IN_SITES: readonly string[] = [
  "https://bazar.arweave.net/",
  "https://ao.arweave.net/",
  "https://www.permatell.xyz/",
  "https://iwashere.ar.io/",
].sort((a, b) => sortName(a).localeCompare(sortName(b)));

export interface SiteHost {
  /** `URL.host`, which is the punycode form for an internationalised name. */
  host: string;
  /** A plain `http:` page. */
  insecure: boolean;
}

/** The host to show for `url`, or `null` when it isn't an http(s) URL. */
export function siteHost(url: string): SiteHost | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return { host: parsed.host, insecure: parsed.protocol === "http:" };
  } catch {
    return null;
  }
}

/**
 * A URL piece decoded for reading, without control or format characters:
 * a decoded bidi override could make it draw over the host.
 */
export function readable(raw: string): string {
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    text = raw;
  }
  return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

/** A segment that reads as an ID (a tx id, hash or token) rather than a word. */
const ID_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;
const MAX_SEGMENT = 32;
/** How much of each end of an ID `pageTrail` keeps when asked to. */
const ID_ENDS = 4;

/**
 * Where on its site `url` is, as path segments to show after the host:
 * `/pomp/claim/72mV…` is `["pomp", "claim", "…"]`. An ID-like or long
 * segment becomes `…` (runs of them one `…`), or with `idEnds` its first
 * and last few characters (`72mV…CVro`), and the query is left out.
 * A hash route (`/#/asset/…`, common on Arweave gateways) counts as the path.
 */
export function pageTrail(url: string, { idEnds = false }: { idEnds?: boolean } = {}): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const hashRoute = /^#!?\//.exec(parsed.hash);
  const path = parsed.pathname === "/" && hashRoute ? (parsed.hash.slice(hashRoute[0].length).split("?")[0] ?? "") : parsed.pathname;
  const trail: string[] = [];
  for (const raw of path.split("/")) {
    if (raw === "") continue;
    const segment = readable(raw);
    if (segment === "") continue;
    const shortened = segment.length > MAX_SEGMENT || ID_SEGMENT.test(segment);
    const shown = !shortened ? segment : idEnds ? `${segment.slice(0, ID_ENDS)}…${segment.slice(-ID_ENDS)}` : "…";
    if (shown === "…" && trail[trail.length - 1] === "…") continue;
    trail.push(shown);
  }
  return trail;
}

const HTTP_SCHEME = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The URL to load for text the user typed, or `null`. There is no search
 * engine: text that isn't an address gets no result. A scheme other than
 * http(s) is refused rather than guessed at, so `javascript:` or `file:`
 * never reaches the view.
 */
export function parseAddress(input: string): string | null {
  const text = input.trim();
  if (text === "" || /\s/.test(text)) return null;
  let candidate: string;
  if (HTTP_SCHEME.test(text)) {
    candidate = text;
  } else if (ANY_SCHEME.test(text) && !/^[^/?#]*:\d+(?:[/?#]|$)/.test(text)) {
    // `host:8080` reads as a scheme to the pattern above but is a port.
    return null;
  } else if (text.includes(".")) {
    candidate = `https://${text}`;
  } else {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.hostname === "" ? null : parsed.href;
  } catch {
    return null;
  }
}

export interface KnownSite {
  /** What opens: an origin or the built-in's URL. */
  url: string;
  host: string;
}

export function knownSite(url: string): KnownSite | null {
  const host = siteHost(url);
  return host ? { url, host: host.host } : null;
}

/** Saved, built-in and recent sites whose host contains `query`, in the order given. */
export function matchSites(query: string, sites: readonly KnownSite[]): KnownSite[] {
  const needle = query.trim().toLowerCase().replace(HTTP_SCHEME, "");
  if (needle === "") return [];
  return sites.filter((site) => site.host.toLowerCase().includes(needle));
}

/**
 * What submitting `input` opens. Text that parses as an address opens
 * exactly as typed, so `arweave.net` never lands on a similar known site.
 * Only text that doesn't parse (`bazar`) opens the first saved, built-in
 * or recent site it matches, and otherwise nothing. Matches while typing
 * are suggestions to tap, not a rewrite of what was written.
 */
export function resolveInput(input: string, sites: readonly KnownSite[]): string | null {
  return parseAddress(input) ?? matchSites(input, sites)[0]?.url ?? null;
}
