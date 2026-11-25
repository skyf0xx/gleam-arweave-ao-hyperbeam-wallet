import type { ActivityEntry, CollectibleRef, TokenBalance } from "@gleam/core";
import { explorerUrlFor } from "@gleam/core";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { displayTicker, formatAtomicCompact } from "./formatWinston";
import type { TFunction } from "../../../i18n";

/**
 * `ActivityEntry` carries only the AO token's processId, not its
 * denomination, so an AO entry's amount is scaled using the matching
 * live balance instead. Falls back to the raw atomic amount and a
 * shortened processId when no matching balance is loaded, rather than
 * mislabeling the entry as AR.
 *
 * A `match` whose `available` is `false` (`handlers/reads.ts`: failed
 * HyperBEAM read, or unconfirmed non-AO denomination) is treated the same
 * as no match — its `denomination` can't be trusted to scale
 * `entry.amount`, which would otherwise show the same guessed-by-orders-
 * of-magnitude number the "unavailable" state exists to prevent. Its
 * `ticker` is still used when resolved (not just an echoed process id),
 * since identity can be known even when the balance isn't.
 */
export function formatActivityAmount(entry: { amount: string | null; token?: string | null }, tokenBalances: TokenBalance[] | undefined): string {
  if (entry.amount === null) return "—";
  if (!entry.token) return `${formatAtomicCompact(entry.amount, 12)} AR`;

  const match = tokenBalances?.find((token) => token.processId === entry.token);
  if (match && match.available !== false) {
    return `${formatAtomicCompact(entry.amount, match.denomination)} ${displayTicker(match.ticker)}`;
  }

  const ticker = match && match.ticker !== entry.token ? match.ticker : entry.token;
  return `${entry.amount} ${displayTicker(ticker)}`;
}

/**
 * A swap order names the asset by its ticker when the user added it, else
 * by a shortened process id: a discovered token's ticker is its own claim.
 */
export function swapAssetLabel(processId: string, tokenBalances: TokenBalance[] | undefined): string {
  const match = tokenBalances?.find((token) => token.processId === processId);
  return match && match.source !== "discovered" && match.ticker !== processId ? displayTicker(match.ticker) : truncateAddress(processId, 6);
}

/** A gateway-only entry knows just the asset's process id. */
export function collectibleLabel(t: TFunction, collectible: CollectibleRef): string {
  return collectible.name ?? t("mainScreen.collectible");
}

/** Opens lunar.arweave.net's block explorer in a new tab, for the wallet ("View all") or one entry's tx id (its detail sheet). */
export function openInExplorer(path: string): void {
  window.open(explorerUrlFor(path), "_blank", "noopener,noreferrer");
}

// A collectible is the thing moved, not the counterparty, so it keeps the "Sent · Beam #1" form.
export function activityTitle(t: TFunction, type: "send" | "receive" | "upload", target: string, isCollectible: boolean): string {
  if (isCollectible) return t("mainScreen.activityTitle", { verb: activityVerb(t, type), target });
  if (type === "send") return t("mainScreen.activitySentTo", { target });
  if (type === "receive") return t("mainScreen.activityReceivedFrom", { target });
  return t("mainScreen.activityTitle", { verb: activityVerb(t, type), target });
}

const DATA_SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatDataSize(bytes: string, locale: string): string {
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1000 && unit < DATA_SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: DATA_SIZE_UNITS[unit],
    // CLDR's short form of "byte" is "byte" for every count in English; the long form plurals it.
    unitDisplay: unit === 0 ? "long" : "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

// The upload's owner is this wallet, so its address says nothing; the content type says what went up.
export function uploadTitle(t: TFunction, entry: ActivityEntry): string {
  const contentType = entry.tags.find((tag) => tag.name.toLowerCase() === "content-type")?.value.trim();
  return t("mainScreen.activityTitle", { verb: t("mainScreen.verbUploaded"), target: contentType || truncateAddress(entry.txId, 6) });
}

function activityVerb(t: TFunction, type: "send" | "receive" | "upload"): string {
  if (type === "send") return t("mainScreen.verbSent");
  if (type === "receive") return t("mainScreen.verbReceived");
  return t("mainScreen.verbUploaded");
}
