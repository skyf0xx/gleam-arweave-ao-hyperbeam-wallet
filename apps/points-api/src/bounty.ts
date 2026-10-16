import { parseArgs } from "node:util";
import type { Db, Queryable } from "./db";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Percent of the pool's balance a finding takes (SCANS.md § Points). */
export const SEVERITY_SHARE_PERCENT: Record<Severity, bigint> = {
  critical: 50n,
  high: 25n,
  medium: 10n,
  low: 2n,
};

const DECIMALS = 12;

/** Atomic points as a decimal with AR's 12 decimals, trailing zeros trimmed. */
export function formatPoints(atomic: bigint): string {
  const negative = atomic < 0n;
  const digits = (negative ? -atomic : atomic).toString().padStart(DECIMALS + 1, "0");
  const whole = digits.slice(0, -DECIMALS).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-DECIMALS).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

const withAtomic = (atomic: bigint) => `${formatPoints(atomic)} points (${atomic} atomic)`;

export interface AwardOptions {
  attestation: string;
  severity: Severity;
  ref: string;
  yes: boolean;
}

export interface VoidOptions {
  attestation: string;
  yes: boolean;
}

function attestationArg(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("--attestation must be the attestation id, 64 lowercase hex characters.");
  }
  return value;
}

export function parseAwardArgs(argv: string[]): AwardOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      attestation: { type: "string" },
      severity: { type: "string" },
      ref: { type: "string" },
      yes: { type: "boolean" },
    },
    strict: true,
  });
  const attestation = attestationArg(values.attestation);
  if (!values.severity || !(SEVERITIES as readonly string[]).includes(values.severity)) {
    throw new Error("--severity must be one of critical, high, medium or low.");
  }
  let ref: string | undefined;
  try {
    const url = new URL(values.ref ?? "");
    if (url.protocol === "https:") ref = url.toString();
  } catch {
    // falls through to the error below
  }
  if (!ref) throw new Error("--ref must be the https URL of the merged PR or published advisory.");
  return { attestation, severity: values.severity as Severity, ref, yes: values.yes ?? false };
}

export function parseVoidArgs(argv: string[]): VoidOptions {
  const { values } = parseArgs({
    args: argv,
    options: { attestation: { type: "string" }, yes: { type: "boolean" } },
    strict: true,
  });
  return { attestation: attestationArg(values.attestation), yes: values.yes ?? false };
}

/** Asks a yes/no question; the CLI wraps readline, tests pass a stub. */
export type Confirm = (question: string) => Promise<boolean>;

interface AttestationRow {
  id: string;
  address: string;
  release: string;
  model: string | null;
  voided_at: Date | null;
}

async function readAttestation(db: Queryable, id: string, lock = false): Promise<AttestationRow> {
  const { rows } = await db.query<AttestationRow>(
    `SELECT id, address, release, body->>'model' AS model, voided_at
       FROM attestations WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!rows[0]) throw new Error(`No attestation has the id ${id}.`);
  return rows[0];
}

async function poolBalance(db: Queryable): Promise<bigint> {
  const { rows } = await db.query<{ balance: string }>("SELECT coalesce(sum(delta_atomic), 0)::text AS balance FROM bounty_pool");
  return BigInt(rows[0]!.balance);
}

async function assertAwardable(db: Queryable, options: AwardOptions, lock = false) {
  const attestation = await readAttestation(db, options.attestation, lock);
  if (attestation.voided_at) throw new Error("That attestation is voided; a voided attestation can't be paid.");
  const wallet = await db.query("SELECT 1 FROM wallets WHERE address = $1", [attestation.address]);
  if (wallet.rows.length === 0) {
    throw new Error(`The wallet ${attestation.address} has left Gleam Points, so it has no points to credit.`);
  }
  const paid = await db.query(
    "SELECT 1 FROM scan_points WHERE ref = $1 UNION ALL SELECT 1 FROM bounty_pool WHERE ref = $1",
    [options.ref],
  );
  if (paid.rows.length > 0) throw new Error(`The ref ${options.ref} has already been paid.`);
  return attestation;
}

function awardAmount(balance: bigint, severity: Severity): bigint {
  if (balance <= 0n) throw new Error("The bounty pool is empty, so there is nothing to award.");
  const amount = (balance * SEVERITY_SHARE_PERCENT[severity]) / 100n;
  if (amount <= 0n) throw new Error("The pool is too small for that severity's share to round to a whole point unit.");
  return amount;
}

export interface AwardResult {
  paid: boolean;
  amount: bigint;
}

/**
 * Prints the award, asks, then pays. The balance is read again under a pool
 * lock before writing; if it moved since the prompt the amount would differ
 * from what was confirmed, so the run stops and can be repeated.
 */
export async function awardFinding(
  db: Db,
  options: AwardOptions,
  confirm: Confirm,
  print: (line: string) => void,
): Promise<AwardResult> {
  const attestation = await assertAwardable(db, options);
  const balance = await poolBalance(db);
  const amount = awardAmount(balance, options.severity);
  const share = SEVERITY_SHARE_PERCENT[options.severity];

  print(`Pool balance:  ${withAtomic(balance)}`);
  print(`Share:         ${share}% (${options.severity})`);
  print(`Amount:        ${withAtomic(amount)}`);
  print(`Wallet:        ${attestation.address}`);
  print(`Attestation:   release ${attestation.release}, model ${attestation.model ?? "unknown"}`);
  print(`Ref:           ${options.ref}`);

  if (!options.yes && !(await confirm(`Pay ${formatPoints(amount)} points to ${attestation.address}? [y/N] `))) {
    print("Cancelled. Nothing was written.");
    return { paid: false, amount };
  }

  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["bounty-pool"]);
    await assertAwardable(tx, options, true);
    const current = await poolBalance(tx);
    if (awardAmount(current, options.severity) !== amount) {
      throw new Error("The pool balance changed while you confirmed. Run the command again.");
    }
    const now = new Date();
    await tx.query(
      "INSERT INTO scan_points (address, attestation_id, kind, amount_atomic, ref, created_at) VALUES ($1, $2, 'finding', $3, $4, $5)",
      [attestation.address, attestation.id, amount.toString(), options.ref, now],
    );
    await tx.query(
      "INSERT INTO bounty_pool (delta_atomic, reason, attestation_id, ref, created_at) VALUES ($1, 'award', $2, $3, $4)",
      [(-amount).toString(), attestation.id, options.ref, now],
    );
  });
  print(`Paid ${withAtomic(amount)} to ${attestation.address}.`);
  return { paid: true, amount };
}

export interface VoidResult {
  voided: boolean;
  removed: bigint;
}

/**
 * Voids an attestation and removes its scan points. Finding points stay: an
 * accepted finding was real work whatever the scan was.
 */
export async function voidAttestation(
  db: Db,
  options: VoidOptions,
  confirm: Confirm,
  print: (line: string) => void,
): Promise<VoidResult> {
  const attestation = await readAttestation(db, options.attestation);
  if (attestation.voided_at) throw new Error(`That attestation was already voided on ${attestation.voided_at.toISOString()}.`);
  const scan = await sumPoints(db, attestation.id, "scan");
  const finding = await sumPoints(db, attestation.id, "finding");

  print(`Attestation:   release ${attestation.release}, model ${attestation.model ?? "unknown"}`);
  print(`Wallet:        ${attestation.address}`);
  print(`Scan points removed:  ${withAtomic(scan)}`);
  print(`Finding points kept:  ${withAtomic(finding)} (an accepted finding was real work, so it stays)`);
  print("Its paid place is freed. GET /attestations may show it for up to 60 seconds.");

  if (!options.yes && !(await confirm(`Void this attestation and remove ${formatPoints(scan)} points? [y/N] `))) {
    print("Cancelled. Nothing was written.");
    return { voided: false, removed: 0n };
  }

  const removed = await db.transaction(async (tx) => {
    const current = await readAttestation(tx, options.attestation, true);
    if (current.voided_at) throw new Error("That attestation was voided while you confirmed.");
    const amount = await sumPoints(tx, current.id, "scan");
    await tx.query("UPDATE attestations SET voided_at = $2 WHERE id = $1", [current.id, new Date()]);
    await tx.query("DELETE FROM scan_points WHERE attestation_id = $1 AND kind = 'scan'", [current.id]);
    return amount;
  });
  print(`Voided. Removed ${withAtomic(removed)}.`);
  return { voided: true, removed };
}

async function sumPoints(db: Queryable, attestationId: string, kind: "scan" | "finding"): Promise<bigint> {
  const { rows } = await db.query<{ total: string }>(
    "SELECT coalesce(sum(amount_atomic), 0)::text AS total FROM scan_points WHERE attestation_id = $1 AND kind = $2",
    [attestationId, kind],
  );
  return BigInt(rows[0]!.total);
}
