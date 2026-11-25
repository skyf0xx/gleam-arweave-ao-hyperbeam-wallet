import { z } from "zod";
import { isRelease } from "./attestation";

export interface ScanStats {
  /** Non-voided attestations of the release. */
  total: number;
  /** Of the release's paid places, how many are still open. */
  paidPlacesLeft: number;
  /** Atomic points a paid scan earns now; null before the first snapshot day or when it can't be read. */
  rewardAtomic: string | null;
  /** Atomic points in the bounty pool; null when it's empty or can't be read. */
  bountyPoolAtomic: string | null;
}

const atomicSchema = z.string().regex(/^[1-9]\d*$/);

const countSchema = z.number().min(0).refine(Number.isInteger);

const countReplySchema = z.object({ total: countSchema, paidPlacesLeft: countSchema });

/** Each field is read on its own: one that doesn't fit is `undefined`, and a reply that isn't an object has none. */
const rewardsReplySchema = z
  .object({
    day: z.string().optional().catch(undefined),
    scanRewardAtomic: atomicSchema.optional().catch(undefined),
    bountyPoolAtomic: atomicSchema.optional().catch(undefined),
  })
  .catch({});

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
  const counts = countReplySchema.safeParse(count);
  if (!counts.success) return null;
  const { day, scanRewardAtomic, bountyPoolAtomic } = rewardsReplySchema.parse(rewards);
  return {
    ...counts.data,
    rewardAtomic: day !== undefined && scanRewardAtomic !== undefined ? scanRewardAtomic : null,
    bountyPoolAtomic: bountyPoolAtomic ?? null,
  };
}
