/**
 * Confirms a URL is actually an Arweave gateway rather than merely
 * reachable. `GET <url>/info` is the standard gateway/node info route
 * (arweave-js's own health convention); a real gateway answers 2xx with
 * JSON whose `network` field starts with "arweave" (e.g.
 * "arweave.N.1", "arweave.testnet.1"). This rejects a reachable-but-wrong
 * host (e.g. https://google.com) that `isGatewayReachable`'s old
 * any-response check would have accepted.
 */
export async function isArweaveGateway(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${url}/info`, { method: "GET" });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") return false;
    const network = (body as Record<string, unknown>).network;
    return typeof network === "string" && network.startsWith("arweave");
  } catch {
    return false;
  }
}
