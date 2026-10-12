import { parseArgs } from "node:util";
import { isValidInviteCode } from "@gleam/core/src/points/index.ts";
import type { Db } from "./db";
import { randomCodeSuffix } from "./invite-code";

export const DEFAULT_DROP_PREFIX = "GLEAM";
// Drop codes are posted publicly, so the random part has to be long enough
// that nobody can guess an unannounced one.
export const DROP_SUFFIX_LENGTH = 8;
const MAX_PREFIX_LENGTH = 16 - DROP_SUFFIX_LENGTH;
const MAX_ATTEMPTS = 5;
export const DEFAULT_SITE_URL = "https://gleamwallet.app/";

export interface DropCodeOptions {
  label: string;
  /** null is a code that never runs out. */
  seats: number | null;
  prefix: string;
  /**
   * When the drop closes. Not stored: it only goes into the link as
   * `?until=`, which `invite.html` reads for its countdown.
   */
  until: Date | null;
}

export interface DropCode {
  code: string;
  seats: number | null;
  label: string;
}

export function parseDropCodeArgs(argv: string[]): DropCodeOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      label: { type: "string" },
      seats: { type: "string" },
      unlimited: { type: "boolean" },
      prefix: { type: "string" },
      until: { type: "string" },
    },
    strict: true,
  });

  const label = values.label?.trim();
  if (!label) throw new Error("--label is required.");

  if (Boolean(values.unlimited) === (values.seats !== undefined)) {
    throw new Error("Pass exactly one of --seats <n> or --unlimited.");
  }
  let seats: number | null = null;
  if (values.seats !== undefined) {
    if (!/^[1-9]\d{0,8}$/.test(values.seats)) throw new Error("--seats must be a positive integer.");
    seats = Number(values.seats);
  }

  const prefix = (values.prefix ?? DEFAULT_DROP_PREFIX).toUpperCase();
  if (!new RegExp(`^[A-Z]{1,${MAX_PREFIX_LENGTH}}$`).test(prefix)) {
    throw new Error(`--prefix must be 1 to ${MAX_PREFIX_LENGTH} letters A-Z.`);
  }

  let until: Date | null = null;
  if (values.until !== undefined) {
    until = new Date(values.until);
    if (Number.isNaN(until.getTime())) throw new Error("--until must be a date, e.g. 2026-10-20T18:00:00Z.");
  }
  return { label, seats, prefix, until };
}

/**
 * `seatsForCode` checks member codes first, so a drop code equal to a
 * wallet's invite code would silently act as that member's code. The
 * clash check shares a transaction with the insert.
 */
export async function createDropCode(
  db: Db,
  options: DropCodeOptions,
  randomSuffix: (length: number) => string = randomCodeSuffix,
): Promise<DropCode> {
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = options.prefix + randomSuffix(DROP_SUFFIX_LENGTH);
      if (!isValidInviteCode(code)) throw new Error(`Generated code "${code}" isn't a valid invite code.`);
      const taken = await tx.query(
        "SELECT 1 FROM wallets WHERE invite_code = $1 UNION ALL SELECT 1 FROM drop_codes WHERE code = $1",
        [code],
      );
      if (taken.rows.length > 0) continue;
      await tx.query("INSERT INTO drop_codes (code, seats, label) VALUES ($1, $2, $3)", [
        code,
        options.seats,
        options.label,
      ]);
      return { code, seats: options.seats, label: options.label };
    }
    throw new Error("Couldn't find an unused code. Try again.");
  });
}

export function dropLink(code: string, until: Date | null, siteUrl: string = DEFAULT_SITE_URL): string {
  const url = new URL("invite.html", siteUrl);
  url.searchParams.set("c", code);
  if (until) url.searchParams.set("until", until.toISOString());
  return url.toString();
}

export function formatDropCode(
  { code, seats, label }: DropCode,
  until: Date | null = null,
  siteUrl: string = DEFAULT_SITE_URL,
): string {
  const summary = `${code}  ${seats === null ? "unlimited seats" : `${seats} seats`}  ${label}`;
  return `${summary}\n${dropLink(code, until, siteUrl)}`;
}
