import { isRelease } from "./attestation";

/**
 * How many attestations a release has, from the points API's
 * `GET /attestations?release=` listing. A release with no scans answers 404
 * `unknown_release`, which reads as zero. Any other failure is null so a
 * caller can show "unknown" rather than a wrong number.
 */
export async function fetchScanCount(deps: {
  apiUrl: string;
  release: string;
  fetchImpl: typeof fetch;
}): Promise<number | null> {
  if (!isRelease(deps.release)) return null;
  try {
    // limit=1: only `total` is wanted, not the page.
    const response = await deps.fetchImpl(
      `${deps.apiUrl}/attestations?release=${encodeURIComponent(deps.release)}&limit=1`,
      { credentials: "omit" },
    );
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 404 && (body as { code?: unknown } | null)?.code === "unknown_release") return 0;
    if (!response.ok) return null;
    const total = (body as { total?: unknown } | null)?.total;
    return typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}
