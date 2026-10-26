/** The built-in dApps, hardcoded so no server can change the list. */
export const BUILT_IN_SITES: readonly string[] = ["https://bazar.arweave.net/", "https://ao.arweave.net/"];

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
