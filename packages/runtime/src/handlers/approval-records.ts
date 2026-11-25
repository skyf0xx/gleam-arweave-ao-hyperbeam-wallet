import { z } from "zod";
import {
  isRecord,
  WALLET_APPROVAL_ORIGIN,
  type ApprovalKind,
  type ApprovalRequest,
  type Grant,
} from "@gleam/core";
import {
  APPROVAL_MAX_MS,
  APPROVAL_TIMEOUT_MS,
  SCAN_ATTESTATION_TIMEOUT_MS,
} from "@gleam/messaging/src/page-protocol.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { permissionTypeSchema } from "../guards";
import { schemaGuard } from "../schema-guard";

export const GRANTS_KEY = "local:grants";

export function activeGrant(grants: readonly Grant[], origin: string): Grant | null {
  const grant = grants.find((candidate) => candidate.origin === origin);
  if (!grant) return null;
  if (grant.expiresAt !== null && grant.expiresAt <= Date.now()) return null;
  return grant;
}

/** How long a request waits for its first answer. */
export function reviewTimeoutMs(kind: ApprovalRequest["kind"]): number {
  return kind === "scanAttestation" ? SCAN_ATTESTATION_TIMEOUT_MS : APPROVAL_TIMEOUT_MS;
}

/** How long past its review timeout a request can wait on a hardware device. */
export const DEVICE_GRACE_MS = APPROVAL_MAX_MS - APPROVAL_TIMEOUT_MS;
export const PENDING_APPROVALS_KEY = "session:pendingApprovals";

const isValidGrant = schemaGuard<Grant>(
  z.object({
    origin: z.string(),
    walletId: z.string(),
    permissions: z.array(permissionTypeSchema),
    createdAt: z.number(),
    expiresAt: z.number().nullable(),
    budget: z.null(),
    icon: z.string().nullish(),
    name: z.string().nullish(),
  }),
);

const approvalRequestSchema = z.object({
  requestId: z.string(),
  kind: z.string(),
  origin: z.string(),
  createdAt: z.number(),
  preview: z.unknown().refine(isRecord),
});

/**
 * `result`, `signingInput` and `device.payloads` hold bytes (payloads, AES
 * IVs, signatures), and `chrome.storage` serializes a `Uint8Array` as a
 * plain object. They are written with `toStored` and read with `fromStored`.
 */
export interface ApprovalOutcome {
  approved: boolean;
  /** Tagged-binary encoded. */
  result?: unknown;
  error?: string;
}

export interface PendingApprovalRecord {
  request: ApprovalRequest;
  /** `null` only for a `connect` made before any wallet existed. */
  walletId: string | null;
  /**
   * A tagged-binary encoded `SigningRequestInput` or `AddTokenRequestInput`;
   * `null` for a `connect` request.
   */
  signingInput: unknown;
  /** A `connect` request's site icon, saved on the grant it creates. */
  siteIcon?: string | null;
  /** Set by `resolveApproval` immediately before the record is removed. */
  outcome?: ApprovalOutcome;
  /**
   * Set, in its own write, just before an approval's work runs. Its work
   * may post a transfer, so a record still carrying it after a worker
   * restart is never run again: the first run may already have posted.
   */
  attempted?: true;
  /** Set once a hardware wallet's request is approved and waits for the device. */
  device?: PendingDeviceSigning;
}

export interface PendingDeviceSigning {
  /** Tagged-binary encoded `UnsignedPayload[]`. */
  payloads: unknown;
  /** Epoch ms. */
  deadline: number;
}

/** Signing kinds a hardware wallet completes with device signatures. */
export const DEVICE_SIGNED_KINDS: ReadonlySet<ApprovalKind> = new Set([
  "sign",
  "dispatch",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
  "transfer",
  "pointsProof",
  "scanAttestation",
  "signMessage",
  "setNameTarget",
]);

export const WALLET_SWITCHED = "The active wallet changed.";

export const SITE_DISCONNECTED = "The site was disconnected.";
export const DISCONNECTED_OUTCOME: ApprovalOutcome = { approved: false, error: SITE_DISCONNECTED };

/** Kinds whose only effect is the result handed back: nothing is posted or stored. */
export const RESULT_ONLY_KINDS: ReadonlySet<ApprovalKind> = new Set([
  "sign",
  "signDataItem",
  "batchSignDataItem",
  "signMessage",
  "encrypt",
  "decrypt",
]);

/**
 * A dApp request the site's grant let through, so it must not outlive the
 * grant. A connect makes a new grant from the user's own approval, and a
 * scan attestation comes from the Gleam site, which holds none.
 */
export function needsGrant(entry: PendingApprovalRecord): boolean {
  const kind = entry.request.kind;
  return kind !== "connect" && kind !== "scanAttestation" && entry.request.origin !== WALLET_APPROVAL_ORIGIN;
}

/**
 * A dApp's signing request signs with the wallet that was active when it
 * was made, and its approval shows no account, so it must not outlive that
 * wallet being active. A connect approval names the wallet it connects, so
 * it goes too. addToken doesn't sign, a scan attestation shows and unlocks
 * its own wallet, and Gleam's own requests name theirs.
 */
export function signsForActiveWallet(entry: PendingApprovalRecord): boolean {
  const kind = entry.request.kind;
  return (
    kind !== "addToken" &&
    kind !== "scanAttestation" &&
    entry.request.origin !== WALLET_APPROVAL_ORIGIN
  );
}

export const TIMED_OUT = userErrorMessage("approvalTimedOut");

/** How soon a timeout looks again at a request that was being resolved when it fired. */
export const RESOLVING_RECHECK_MS = 5_000;

export function validGrants(raw: unknown): Grant[] {
  return Array.isArray(raw) ? raw.filter(isValidGrant) : [];
}

const pendingRecordSchema = z.object({ request: approvalRequestSchema, walletId: z.string().nullable() });

export function validPending(raw: unknown): PendingApprovalRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(schemaGuard<PendingApprovalRecord>(pendingRecordSchema));
}
