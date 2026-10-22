import { isRelease } from "./attestation";
import { nextScanIsFull } from "./rewards";

export interface ScanStats {
  /** Non-voided attestations of the release. */
  total: number;
  /** Of the release's paid places, how many are still open. */
  paidPlacesLeft: number;
  /** Atomic points the release's next paid scan earns now, full or tail; null before the first snapshot day or when it can't be read. */
  rewardAtomic: string | null;
  /** Atomic points in the bounty pool; null when it's empty or can't be read. */
  bountyPoolAtomic: string | null;
}

const isAtomic = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value);

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

async function readJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { credentials: "omit" });
    const body: unknown = await response.json().catch(() => null);
    return response.ok ? body : null;
  } catch {
    return null;
  }
}

/**
 * A release's scan count and paid places left, from the points API's cheap
 * `GET /attestations/count?release=` route (no coverage, no GitHub call),
 * which answers 0 scans for a release with none, plus what the next paid
 * scan earns and the bounty pool from `GET /scan/rewards`. A failed count is null so a caller can show
 * "unknown" rather than a wrong number; a failed reward only nulls the reward.
 */
export async function fetchScanStats(deps: {
  apiUrl: string;
  release: string;
  fetchImpl: typeof fetch;
}): Promise<ScanStats | null> {
  if (!isRelease(deps.release)) return null;
  const [count, rewards] = await Promise.all([
    readJson(deps.fetchImpl, `${deps.apiUrl}/attestations/count?release=${encodeURIComponent(deps.release)}`),
    readJson(deps.fetchImpl, `${deps.apiUrl}/scan/rewards`),
  ]);
  const { total, paidPlacesLeft } = (count ?? {}) as { total?: unknown; paidPlacesLeft?: unknown };
  if (!isCount(total) || !isCount(paidPlacesLeft)) return null;
  const { day, scanRewardAtomic, tailScanRewardAtomic, bountyPoolAtomic } = (rewards ?? {}) as {
    day?: unknown;
    scanRewardAtomic?: unknown;
    tailScanRewardAtomic?: unknown;
    bountyPoolAtomic?: unknown;
  };
  const next = nextScanIsFull(paidPlacesLeft) ? scanRewardAtomic : tailScanRewardAtomic;
  const rewardAtomic = typeof day === "string" && isAtomic(next) ? next : null;
  return { total, paidPlacesLeft, rewardAtomic, bountyPoolAtomic: isAtomic(bountyPoolAtomic) ? bountyPoolAtomic : null };
}
