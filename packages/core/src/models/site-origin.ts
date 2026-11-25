export const SITE_URL = "https://gleamwallet.app/";

/** The only origin `externally_connectable` lets message a production build. */
export const SITE_ORIGIN = new URL(SITE_URL).origin;

/**
 * Hosts a development build also takes site messages from, on any port,
 * so a local copy of the site (`attest.html`) can be tested before it
 * deploys. `wxt.config.ts` adds them to `externally_connectable` only in
 * development mode, and `isSiteOrigin` accepts them only when the
 * runtime is told it is a development build.
 */
export const DEV_SITE_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** The origin of an http(s) URL, or null for any other scheme or a string that isn't a URL. */
export function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * True for an http(s) origin in its exact serialized form. "null", file:,
 * data:, about: and other schemes fail, and so does anything with a path,
 * a trailing slash, a default port or different case.
 */
export function isExactHttpOrigin(value: unknown): value is string {
  return typeof value === "string" && httpOrigin(value) === value;
}
