import { isRelease } from "./attestation";

/**
 * How many attestations a release has, from the points API's cheap
 * `GET /attestations/count?release=` route (no coverage, no GitHub call),
 * which answers 0 for a release with no scans. Any failure is null so a
 * caller can show "unknown" rather than a wrong number.
 */
export async function fetchScanCount(deps: {
  apiUrl: string;
  release: string;
  fetchImpl: typeof fetch;
}): Promise<number | null> {
  if (!isRelease(deps.release)) return null;
  try {
    const response = await deps.fetchImpl(
      `${deps.apiUrl}/attestations/count?release=${encodeURIComponent(deps.release)}`,
      { credentials: "omit" },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return null;
    const total = (body as { total?: unknown } | null)?.total;
    return typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}
