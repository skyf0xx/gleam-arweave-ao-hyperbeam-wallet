const STATE_TIMEOUT_MS = 8_000;

/**
 * The raw `logo` a `token@1.0` process keeps in its live HyperBEAM state.
 * A `HEAD` on `/{processId}~process@1.0/compute` returns the state's
 * scalar fields as response headers, `logo` among them, without the
 * balances body; this is the read permawebOS makes. (`compute/token-info`
 * answers 404 for these tokens.) The value is untrusted: callers must pass
 * it through `tokenLogoUrl` before loading it.
 *
 * `null` means the node answered and the token has no logo, including a
 * 4xx (the node doesn't serve this process, so asking again won't help).
 * A network failure, timeout or 5xx throws, so the caller can tell "no
 * logo" from "couldn't ask" and retry the latter.
 */
export async function readTokenStateLogo(
  processId: string,
  peerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(`${peerUrl.replace(/\/+$/, "")}/${processId}~process@1.0/compute&max-age=60`, {
    method: "HEAD",
    signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
  });
  if (response.status >= 500) throw new Error(`Token state request failed (${response.status}).`);
  if (!response.ok) return null;
  const logo = response.headers.get("logo")?.trim();
  return logo ? logo : null;
}

/**
 * The Arweave block height a `token@1.0` process has applied messages up
 * to, from the `swap-height` its live state carries. The process reaches a
 * block about 2 confirmations after it is mined, so a transfer in that
 * block moves the balance only once this catches up.
 */
export async function readTokenSwapHeight(processId: string, nodeUrl: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl(`${nodeUrl.replace(/\/+$/, "")}/${processId}~process@1.0/compute&max-age=60`, {
    method: "HEAD",
    signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
  });
  const height = Number(response.headers.get("swap-height") ?? "");
  if (!response.ok || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`Token state request failed (${response.status}).`);
  }
  return height;
}
