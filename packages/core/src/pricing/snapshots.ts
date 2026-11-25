import { isPlainRecord, isRecord } from "../models/guards";

/**
 * A token priced from its own orderbook has no 24h change from any
 * provider, so the device keeps its own USD price samples per process id
 * and compares against one taken about a day ago.
 */
const HOUR_MS = 60 * 60 * 1000;

/** One sample per this long, so a day's worth stays a handful of entries. */
const SAMPLE_SPACING_MS = 4 * HOUR_MS;
const KEEP_MS = 30 * HOUR_MS;
const BASELINE_MIN_AGE_MS = 20 * HOUR_MS;
const BASELINE_MAX_AGE_MS = 28 * HOUR_MS;
const BASELINE_TARGET_AGE_MS = 24 * HOUR_MS;

export interface PriceSnapshot {
  at: number;
  usd: number;
}

/** Keyed by AO process id. */
export type PriceSnapshots = Record<string, PriceSnapshot[]>;

function isSnapshot(value: unknown): value is PriceSnapshot {
  return isRecord(value) && Number.isFinite(value.at) && Number.isFinite(value.usd) && (value.usd as number) > 0;
}

/** Stored data is untrusted: anything malformed is dropped, not repaired. */
export function parsePriceSnapshots(raw: unknown): PriceSnapshots {
  if (!isPlainRecord(raw)) return {};
  const parsed: PriceSnapshots = {};
  for (const [processId, list] of Object.entries(raw)) {
    if (Array.isArray(list)) parsed[processId] = list.filter(isSnapshot);
  }
  return parsed;
}

/**
 * The move since the sample closest to 24 hours old, or `null` when none is
 * between 20 and 28 hours old.
 */
export function changeSinceYesterday(samples: readonly PriceSnapshot[], usd: number, now: number): number | null {
  let baseline: PriceSnapshot | undefined;
  for (const sample of samples) {
    const age = now - sample.at;
    if (age < BASELINE_MIN_AGE_MS || age > BASELINE_MAX_AGE_MS) continue;
    if (!baseline || Math.abs(age - BASELINE_TARGET_AGE_MS) < Math.abs(now - baseline.at - BASELINE_TARGET_AGE_MS)) baseline = sample;
  }
  return baseline ? usd / baseline.usd - 1 : null;
}

/** Adds `usd` as a sample unless one was taken recently, and drops samples too old to compare against. */
export function recordPriceSample(samples: readonly PriceSnapshot[], usd: number, now: number): PriceSnapshot[] {
  const kept = samples.filter((sample) => now - sample.at <= KEEP_MS && sample.at <= now);
  const newest = kept.reduce((latest, sample) => Math.max(latest, sample.at), -Infinity);
  return now - newest >= SAMPLE_SPACING_MS ? [...kept, { at: now, usd }] : kept;
}
