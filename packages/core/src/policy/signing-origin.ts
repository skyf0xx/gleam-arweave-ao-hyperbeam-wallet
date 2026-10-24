const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when `origin` may connect or ask for a signature: https, or plain
 * http on a loopback host for local dApp development. On any other plain
 * http page an attacker on the network can inject script, so a request
 * from it can't be trusted to be the site's own.
 */
export function isSecureSigningOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}
