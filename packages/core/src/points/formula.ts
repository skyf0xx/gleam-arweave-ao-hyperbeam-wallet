/**
 * The daily points formula (POINTS.md § Rules). Points are atomic
 * integers with AR's and AO's 12 decimals, so a balance in atomic units
 * is already its daily holding points and no conversion is needed.
 */

export interface WalletSnapshot {
  address: string;
  arAtomic: string;
  aoAtomic: string;
  /** Whether the wallet's install sent a heartbeat inside the liveness window. */
  live: boolean;
  referredBy: string | null;
  /** Backfilled before Phase 1, so never had a code to redeem. */
  originalFounder: boolean;
}

export interface DailyPoints {
  holdingAtomic: string;
  refereeBonusAtomic: string;
  /** The referee bonus for an original founder with no referrer. */
  founderBonusAtomic: string;
  referrerBonusAtomic: string;
  totalAtomic: string;
}

const BONUS_DIVISOR = 10n;

/** A live wallet's holding points for one day; 0 when it isn't live. */
export function basePoints(snapshot: Pick<WalletSnapshot, "arAtomic" | "aoAtomic" | "live">): bigint {
  if (!snapshot.live) return 0n;
  return parseAtomic(snapshot.arAtomic) + parseAtomic(snapshot.aoAtomic);
}

/**
 * Points every wallet in one day's snapshot earns, keyed by address.
 *
 * Bonuses are always 10% of the referee's base, rounded down, so
 * referral points never earn referral points. A referrer that isn't live,
 * or isn't in the snapshot at all, earns nothing that day. The referee's
 * own bonus doesn't depend on its referrer being live. An original
 * founder with no referrer gets the same 10% with nobody paid for it; one
 * with a referrer gets it once, as a referee.
 */
export function computeDailyPoints(snapshots: readonly WalletSnapshot[]): Map<string, DailyPoints> {
  const byAddress = new Map<string, WalletSnapshot>();
  for (const snapshot of snapshots) {
    if (byAddress.has(snapshot.address)) {
      throw new Error(`Wallet ${snapshot.address} appears twice in one snapshot.`);
    }
    byAddress.set(snapshot.address, snapshot);
  }

  const base = new Map<string, bigint>();
  for (const snapshot of snapshots) base.set(snapshot.address, basePoints(snapshot));

  const referrerBonus = new Map<string, bigint>();
  const refereeBonus = new Map<string, bigint>();
  const founderBonus = new Map<string, bigint>();
  for (const snapshot of snapshots) {
    const referrer = snapshot.referredBy;
    if (referrer === null || referrer === snapshot.address) {
      if (snapshot.originalFounder) founderBonus.set(snapshot.address, base.get(snapshot.address)! / BONUS_DIVISOR);
      continue;
    }
    const bonus = base.get(snapshot.address)! / BONUS_DIVISOR;
    refereeBonus.set(snapshot.address, bonus);
    if (byAddress.get(referrer)?.live) {
      referrerBonus.set(referrer, (referrerBonus.get(referrer) ?? 0n) + bonus);
    }
  }

  const result = new Map<string, DailyPoints>();
  for (const snapshot of snapshots) {
    const holding = base.get(snapshot.address)!;
    const asReferee = refereeBonus.get(snapshot.address) ?? 0n;
    const asFounder = founderBonus.get(snapshot.address) ?? 0n;
    const asReferrer = referrerBonus.get(snapshot.address) ?? 0n;
    result.set(snapshot.address, {
      holdingAtomic: holding.toString(),
      refereeBonusAtomic: asReferee.toString(),
      founderBonusAtomic: asFounder.toString(),
      referrerBonusAtomic: asReferrer.toString(),
      totalAtomic: (holding + asReferee + asFounder + asReferrer).toString(),
    });
  }
  return result;
}

const MS_PER_DAY = 86_400_000n;

export interface PointsEstimateInput {
  /** Total points as of the last snapshot the server reported. */
  settledAtomic: string;
  /** When that snapshot was taken, in epoch milliseconds. */
  settledAtMs: number;
  /** Points per day the wallet currently earns. */
  dailyRateAtomic: string;
  nowMs: number;
}

/**
 * Projects the points total between snapshots so the header chip can
 * tick live. The projection stops after one day: past that the next
 * snapshot is overdue, and showing points the server may never credit
 * would overstate the total.
 */
export function estimatePoints(input: PointsEstimateInput): string {
  const elapsed = BigInt(Math.min(Math.max(input.nowMs - input.settledAtMs, 0), Number(MS_PER_DAY)));
  const settled = parseAtomic(input.settledAtomic);
  const accrued = (parseAtomic(input.dailyRateAtomic) * elapsed) / MS_PER_DAY;
  return (settled + accrued).toString();
}

/**
 * Daily rate from a wallet's own balances and whether it was referred.
 * The referrer share depends on other wallets' balances, so callers add
 * the server-reported `referrerBonusAtomic` to this.
 */
export function ownDailyRate(arAtomic: string, aoAtomic: string, referred: boolean, originalFounder = false): string {
  const base = parseAtomic(arAtomic) + parseAtomic(aoAtomic);
  return (referred || originalFounder ? base + base / BONUS_DIVISOR : base).toString();
}

function parseAtomic(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected an atomic integer string, got "${value}".`);
  }
  return BigInt(value);
}
