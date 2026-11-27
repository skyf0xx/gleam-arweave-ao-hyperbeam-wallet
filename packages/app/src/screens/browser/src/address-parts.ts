import { parse } from "tldts";
import { readable } from "./address";

export interface QueryPart {
  key: string;
  value: string;
}

/** An http(s) URL split into the parts a person reads to judge it. */
export interface AddressParts {
  /** `https://` or `http://`. */
  scheme: string;
  /** What comes before `site`, without its trailing dot: `app` in `app.permaswap.network`. */
  subdomain: string;
  /**
   * The registrable domain (`example.co.uk`, `user.github.io`), which is who
   * runs the page. The whole host for an IP address or `localhost`.
   * Punycode for an internationalised name, as `URL` gives it.
   */
  site: string;
  port: string;
  path: string[];
  query: QueryPart[];
  fragment: string;
  insecure: boolean;
  /** The URL exactly as loaded, for copying. */
  href: string;
}

/** `url`'s parts, or `null` when it isn't an http(s) URL. */
export function addressParts(url: string): AddressParts | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const { hostname } = parsed;
  // Private suffixes (github.io, vercel.app) count, so each user's site is its own.
  const info = parse(hostname, { allowPrivateDomains: true });
  const site = !info.isIp && info.domain ? info.domain : hostname;
  return {
    scheme: `${parsed.protocol}//`,
    subdomain: site === hostname ? "" : hostname.slice(0, -site.length - 1),
    site,
    port: parsed.port,
    path: parsed.pathname.split("/").map(readable).filter((segment) => segment !== ""),
    query: parsed.search
      .slice(1)
      .split("&")
      .filter((pair) => pair !== "")
      .map((pair) => {
        const at = pair.indexOf("=");
        return at === -1 ? { key: readable(pair), value: "" } : { key: readable(pair.slice(0, at)), value: readable(pair.slice(at + 1)) };
      }),
    fragment: readable(parsed.hash.slice(1)),
    insecure: parsed.protocol === "http:",
    href: parsed.href,
  };
}
