/** Scans paid per release; later ones are recorded and earn nothing. */
export const PAID_SCANS_PER_RELEASE = 100;
/** The first this-many paid scans of a release earn the full reward; the rest earn the tail reward. */
export const FULL_REWARD_SCANS = 20;
/** A full-reward scan earns 1/1000 (0.1%) of the previous day's total holding points. */
const FULL_REWARD_DIVISOR = 1000n;
/** A tail scan earns 1/5000 (0.02%). */
const TAIL_REWARD_DIVISOR = 5000n;

/** Both scan rewards for a day that issued `issuedAtomic` holding points, truncated. */
export function scanRewards(issuedAtomic: bigint): { fullAtomic: bigint; tailAtomic: bigint } {
  return { fullAtomic: issuedAtomic / FULL_REWARD_DIVISOR, tailAtomic: issuedAtomic / TAIL_REWARD_DIVISOR };
}

/** Whether the next scan of a release with `paidPlacesLeft` open places earns the full reward. */
export function nextScanIsFull(paidPlacesLeft: number): boolean {
  return paidPlacesLeft > PAID_SCANS_PER_RELEASE - FULL_REWARD_SCANS;
}
