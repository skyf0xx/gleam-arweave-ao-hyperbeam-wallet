import { DEFAULT_HYPERBEAM_PEER_URLS } from "@gleam/core";

export function isHardcodedPeer(peerUrl: string): boolean {
  return (DEFAULT_HYPERBEAM_PEER_URLS as readonly string[]).includes(peerUrl);
}

/** Host and port in full: a lookalike peer can differ only at the end. */
export function peerHost(peerUrl: string): string {
  try {
    return new URL(peerUrl).host;
  } catch {
    return peerUrl;
  }
}

export function normalizePeerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Stricter than `normalizePeerUrl`: the gateway must already be an
 * `https://` URL rather than having one assumed for it, since silently
 * upgrading a bare host here could mask a typo as a plaintext origin
 * instead of failing loudly.
 */
export function normalizeGatewayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * MV3 host-permission match pattern for a peer's origin — protocol +
 * host, wildcarded path (`<scheme>://<host>/*`) per
 * `chrome.permissions.request`'s documented match-pattern shape. Derived
 * from the already-normalized peer URL rather than the raw input, so it
 * always reflects a URL `normalizePeerUrl` has already validated.
 */
export function peerOriginPattern(normalizedPeerUrl: string): string {
  const url = new URL(normalizedPeerUrl);
  return `${url.protocol}//${url.host}/*`;
}
