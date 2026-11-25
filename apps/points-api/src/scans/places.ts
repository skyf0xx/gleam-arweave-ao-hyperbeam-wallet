import { paidPlacesFor } from "@gleam/core/src/scan/index.ts";
import { queryNumber, type Queryable } from "../db";
import type { GithubClient, ReleaseFunction } from "./github";
import { examinedFunctions } from "./areas";

/** A release's paid places: how many it opened, how many paid scans took, and how many are open. */
export interface PaidPlaces {
  total: number;
  taken: number;
  left: number;
}

async function storedTotal(db: Queryable, release: string): Promise<number | null> {
  const { rows } = await db.query<{ paid_places: number }>("SELECT paid_places FROM scan_releases WHERE release = $1", [release]);
  return rows[0]?.paid_places ?? null;
}

/**
 * Fixes the release's paid places the first time it is asked: one per
 * challenge's worth of functions no scan has examined in their current
 * text, within the release's floor and the cap. Kept, so the total doesn't fall while
 * scans examine the functions it was counted from.
 */
export async function openRelease(db: Queryable, release: string, functions: readonly ReleaseFunction[]): Promise<number> {
  const stored = await storedTotal(db, release);
  if (stored !== null) return stored;
  const examined = await examinedFunctions(db, release, functions);
  await db.query("INSERT INTO scan_releases (release, paid_places, created_at) VALUES ($1, $2, now()) ON CONFLICT (release) DO NOTHING", [
    release,
    paidPlacesFor(functions.length - examined.size, release),
  ]);
  return (await storedTotal(db, release))!;
}

/**
 * The release's paid places. One that hasn't opened any opens them now if
 * it is the latest (a GitHub read, once); any other release opened none,
 * since only the latest can be scanned.
 */
export async function paidPlaces(db: Queryable, github: GithubClient, release: string): Promise<PaidPlaces> {
  let total = await storedTotal(db, release);
  if (total === null) {
    const latest = await github.latestRelease();
    total = latest?.release === release ? await openRelease(db, release, (await github.filesAt(latest.commit)).functions) : 0;
  }
  const taken = await queryNumber(
    db,
    "SELECT count(*)::text AS taken FROM attestations WHERE release = $1 AND paid AND voided_at IS NULL",
    [release],
    "taken",
  );
  return { total, taken, left: Math.max(0, total - taken) };
}
