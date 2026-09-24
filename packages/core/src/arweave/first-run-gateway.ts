import { isArweaveGateway } from "./gateway";

/**
 * Full AR.IO gateways to try, in order, if `https://arweave.net` itself
 * doesn't answer as a gateway on first run. Each one must expose `/info`
 * the same way arweave.net does — a GraphQL-only host (e.g. goldsky)
 * would never pass `isArweaveGateway` and has no place here. Every entry
 * must also be covered by the manifest's `host_permissions`
 * (`apps/extension/wxt.config.ts`) or it would pass this check and then
 * fail on the reads that follow — build config can't import this
 * package, so keep the two lists in sync by hand.
 */
export const FALLBACK_GATEWAY_URLS: readonly string[] = ["https://ar-io.dev", "https://permagate.io"];

const PRIMARY_GATEWAY_URL = "https://arweave.net";

/**
 * Picks the gateway a first-run install should default to: `arweave.net`
 * if it answers, else the first fallback that does, else `arweave.net`
 * anyway (a network hiccup at install time shouldn't leave the wallet
 * with no gateway configured at all — the existing "unreachable" UX
 * elsewhere already handles that case).
 *
 * Pure and side-effect-free beyond the passed-in `fetchImpl`: never
 * throws, never touches storage. The caller (background's `onInstalled`)
 * decides whether and how to persist the result, and only when no
 * settings exist yet — this never overwrites a user's existing gateway.
 */
export async function resolveInitialGatewayUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    if (await isArweaveGateway(PRIMARY_GATEWAY_URL, fetchImpl)) {
      return PRIMARY_GATEWAY_URL;
    }
    for (const candidate of FALLBACK_GATEWAY_URLS) {
      if (await isArweaveGateway(candidate, fetchImpl)) {
        return candidate;
      }
    }
    return PRIMARY_GATEWAY_URL;
  } catch {
    return PRIMARY_GATEWAY_URL;
  }
}
