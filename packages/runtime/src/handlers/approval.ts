import {
  addressFromOwner,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  capabilitiesFor,
  decrypt,
  DEFAULT_BUNDLER_URL,
  encrypt,
  finishDataItem,
  finishDataItems,
  finishDispatch,
  finishSignTransaction,
  isHardwareWalletMethod,
  WATCH_ONLY_CONNECT_REFUSAL,
  prepareDataItem,
  prepareDataItems,
  prepareDispatch,
  prepareSignTransaction,
  HARDWARE_MESSAGE_HASH,
  signMessage as vaultSignMessage,
  signPayloadWithSigner,
  verifyDeviceSignature,
  PERMISSION_TYPES,
  WALLET_APPROVAL_ORIGIN,
  type AddTokenApprovalPreview,
  type CollectibleRef,
  type ApprovalKind,
  type ApprovalPresenterPort,
  type ApprovalPreview,
  type ApprovalRequest,
  type ConnectAppInfo,
  type ConnectApprovalPreview,
  type DataItemInput,
  type DeviceSigningPayload,
  type EncryptAlgorithm,
  type Grant,
  type HardwareDevice,
  type HardwareWalletMethod,
  type WalletMethod,
  type PermissionType,
  type ScanAttestationApprovalPreview,
  type SignTransactionInput,
  type SigningApprovalPreview,
  type StoragePort,
  type UnsignedPayload,
} from "@gleam/core";
import {
  APPROVAL_MAX_MS,
  APPROVAL_TIMEOUT_MS,
  SCAN_ATTESTATION_TIMEOUT_MS,
} from "@gleam/messaging/src/page-protocol.ts";
import { updateStored } from "../storage-update";
import {
  buildAttestMessage,
  buildOwnershipTransaction,
  POINTS_PROOF_TAG,
} from "@gleam/core/src/points/index.ts";
import {
  attestationId,
  parseAttestation,
  type Attestation,
  type ParsedAttestation,
} from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import type { AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import type { ApprovalShown } from "@gleam/messaging/src/protocol.ts";
import { readAoTransferMessage } from "@gleam/core/src/ao/transfer-message.ts";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import type { KeySession } from "./key-session";
import { attestFailure } from "./attest-errors";
import type { OwnershipProof } from "./points";
import type { SubmitTransferRequest } from "./transfer";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { safeSiteIconUrl } from "./site-wallet";
import { dappError } from "../dapp-error";
import {
  assertTransferMatches,
  checkDataItem,
  checkTransaction,
  dataItemOf,
  mismatch,
  summarize,
  transactionOf,
  UNSAFE_TEXT,
} from "./prepared-check";

/**
 * Background-side implementation of `ProtocolMap`'s `getApproval`/
 * `resolveApproval`, plus the internal (non-`ProtocolMap`) API the
 * `background.ts` dispatcher uses to actually create an `ApprovalRequest`,
 * show its approval UI, and await the user's decision before letting a
 * page-originated provider call resume. `connect()` requests show the
 * origin and requested permission scopes and open in their own approval UI (a window, or a sheet on a phone); a
 * signing approval shows recipient, amount, fee, a decoded-data preview,
 * tags, and a SHA-256 hash.
 *
 * Storage schema this handler owns:
 * - `local:grants` — `Grant[]`, one per approved `connect()` origin. This
 *   handler's own `getConnectedApps` is a straight read of this key
 *   (filtered through `isValidGrant`), since a Grant already carries every
 *   field `connected-apps.html` renders (origin, permissions, expiresAt,
 *   createdAt). Revoking removes the origin's entry from this same array;
 *   `getConnectedApps` needs no separate change to see a revoke take
 *   effect.
 * - `session:pendingApprovals` — `ApprovalRequest[]`, ephemeral
 *   (`chrome.storage.session`, memory-only) rather than `local:`: an
 *   in-flight connection/signing request has no reason to survive a full
 *   browser restart — if the browser closes mid-approval, the dApp's
 *   original call is gone too. Session-scoped storage still survives an
 *   MV3 service-worker idle-kill/restart while the approval UI stays
 *   open, which is the restart this needs to survive.
 *
 * Waiting for resolution: the dispatcher's `requestApproval()` call
 * resolves only once `resolveApproval` is called for that `requestId`.
 * Rather than a service-worker-local `Map<requestId, deferred>` result
 * store (which cannot survive an SW restart while the approval UI is
 * still open), `resolveApproval` writes its outcome (`approved`/`result`/
 * `error`) directly onto the pending record in `session:pendingApprovals`
 * *before* removing it, and `requestApproval`'s `StoragePort.watch`
 * callback reads that outcome back off the emitted value itself — no
 * separate in-memory map. This still cannot make the *original* page
 * caller's in-flight promise survive an SW restart (an inherent MV3
 * limitation: a page's provider call has no way to survive its own
 * originating dispatcher call context dying either), but it does mean the
 * resolution data itself is never only-in-memory.
 *
 * Closing the approval UI (a window's close button, a sheet swiped away)
 * counts as a rejection: `ApprovalPresenterPort.onDismissed` writes a rejected outcome
 * the same way `resolveApproval` does, so the dApp hears back at once
 * instead of after the review timeout (`reviewTimeoutMs`).
 *
 * Hardware wallets: the service worker can't reach the camera or WebHID,
 * so every hardware signature is made in the approval UI. Approving
 * a hardware wallet's request builds the unsigned payloads from the
 * wallet's stored public key and moves the record to "awaiting device"
 * (`PendingApprovalRecord.device`) instead of finishing it. The UI
 * then sends `submitDeviceSignature`, which verifies each signature
 * against that key before anything is returned or posted. A signature
 * that fails verification leaves the request waiting so the user can
 * sign again. While waiting, the timeout follows `device.deadline`,
 * which `deviceActivity` pushes back up to `deviceDeadline`'s cap
 * (`APPROVAL_MAX_MS` from creation for a dApp request).
 *
 * Deadlines are also enforced on read, since an evicted service worker
 * loses its timers: a record past its deadline (`device.deadline`, or
 * `reviewTimeoutMs(kind)` after creation while in review) is hidden from
 * every read and pruned on the next write, unless it is being resolved.
 */
const GRANTS_KEY = "local:grants";

function activeGrant(grants: readonly Grant[], origin: string): Grant | null {
  const grant = grants.find((candidate) => candidate.origin === origin);
  if (!grant) return null;
  if (grant.expiresAt !== null && grant.expiresAt <= Date.now()) return null;
  return grant;
}

/** How long a request waits for its first answer. */
function reviewTimeoutMs(kind: ApprovalRequest["kind"]): number {
  return kind === "scanAttestation" ? SCAN_ATTESTATION_TIMEOUT_MS : APPROVAL_TIMEOUT_MS;
}

/** How long past its review timeout a request can wait on a hardware device. */
const DEVICE_GRACE_MS = APPROVAL_MAX_MS - APPROVAL_TIMEOUT_MS;
const PENDING_APPROVALS_KEY = "session:pendingApprovals";

function isValidPermissionType(value: unknown): value is PermissionType {
  return typeof value === "string" && (PERMISSION_TYPES as readonly string[]).includes(value);
}

function isValidGrant(value: unknown): value is Grant {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.origin === "string" &&
    typeof candidate.walletId === "string" &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every(isValidPermissionType) &&
    typeof candidate.createdAt === "number" &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === "number") &&
    candidate.budget === null &&
    (candidate.icon === undefined || candidate.icon === null || typeof candidate.icon === "string") &&
    (candidate.name === undefined || candidate.name === null || typeof candidate.name === "string")
  );
}

function isValidApprovalRequest(value: unknown): value is ApprovalRequest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.origin === "string" &&
    typeof candidate.createdAt === "number" &&
    candidate.preview !== null &&
    typeof candidate.preview === "object"
  );
}

/** A signing request's decoded intent — the input to `describeIntent`-style preview building. */
export interface SigningRequestInput {
  kind: Exclude<ApprovalKind, "connect" | "addToken">;
  /** Present for value-transfer-shaped calls (`sign` a transfer, `dispatch`, `transferAoTokens`). */
  recipient?: string | null;
  amount?: string | null;
  fee?: string | null;
  /**
   * Identifies which token `amount`/`fee` are denominated in — `null` for the
   * native AR token, an AO processId otherwise. Only ever set for
   * `transferAoTokens` today (see `SigningApprovalPreview.token`'s own doc
   * comment); every other signing kind carries no token.
   */
  token?: string | null;
  /**
   * Decimal-places count for `token`'s atomic `amount` — resolved by the
   * dispatcher the same way a token balance's denomination is (`ReadsHandler.
   * previewWatchedToken`) before calling `requestApproval`. `undefined`/`null`
   * when `token` is `null` or that resolution failed; the approval screen
   * then falls back to the raw atomic amount (see `SigningApprovalPreview.
   * tokenDenomination`'s own doc comment).
   */
  tokenDenomination?: number | null;
  /**
   * `token`'s resolved ticker from that same lookup — the unit label shown
   * once the amount is scaled by `tokenDenomination`. `undefined`/`null`
   * when `token` is `null` or the lookup didn't resolve a ticker (see
   * `SigningApprovalPreview.tokenTicker`'s own doc comment).
   */
  tokenTicker?: string | null;
  /** A wallet `transfer` of this collectible: an L1 transaction to its process carrying the transfer tags. */
  collectible?: CollectibleRef | null;
  /** See `SigningApprovalPreview.unreadableTokenTransfer`. */
  unreadableTokenTransfer?: boolean;
  /** Raw bytes this request will sign/encrypt/decrypt, for the payload hash and decoded preview. */
  payload: Uint8Array;
  tags?: Array<{ name: string; value: string }>;
  /** `true` when the review screen must escalate to Irreversible-tier framing. */
  firstSeenOrHighRisk?: boolean;
  /**
   * Gateway URL `sign`/`dispatch` need to construct an arweave-js client
   * (for `last_tx`/reward defaults and, for `dispatch`, posting a `BASE`
   * transaction) — resolved by the dispatcher from `ReadsHandler.
   * getNetworkSettings()` at call time, since `ApprovalHandler` itself has
   * no network-settings storage access of its own.
   */
  gatewayUrl?: string;
  /** Bundler a bundled `dispatch` posts to, from the same settings read; the handler's own default otherwise. */
  bundlerUrl?: string;
  /** `sign`/`dispatch`'s transaction-shaped fields beyond `payload`/`tags` — `target`/`quantity`/`reward`/`last_tx`. */
  target?: string;
  quantity?: string;
  reward?: string;
  last_tx?: string;
  /** `signDataItem`/`batchSignDataItem`'s items. `payload` and `tags` above are the first item's, for the preview. */
  dataItems?: DataItemInput[];
  /**
   * Display-only token metadata for each `dataItems` entry that is an AO
   * transfer, by index; never signed. The transfer itself is read from
   * the item. `collectible` is set when the process is a collectible
   * rather than a token, so a transfer of 1 previews as that collectible.
   */
  itemTokenMetadata?: Array<{ tokenDenomination: number | null; tokenTicker: string | null; collectible?: boolean } | null>;
  /** `encrypt`/`decrypt`'s WebCrypto algorithm parameter. */
  encryptAlgorithm?: EncryptAlgorithm;
  /** `signMessage`'s hash digest selection. */
  hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512";
  /**
   * `scanAttestation`'s attestation, as `parseAttestation` returned it.
   * `payload` is then the attest message it signs.
   */
  attestation?: Attestation;
  /** `scanAttestation`'s signing wallet address, for the preview. */
  address?: string;
}

/**
 * The `AoTokenTransferRequest` shape a `transferAoTokens` signing approval
 * carries through to `performSigning`, so it can call
 * `TransferHandler.submitTransfer` with exactly the fields that handler
 * needs (`token`/`recipient`/`amount`/`fee`/`walletId`) once the user
 * approves — never re-derived from the decoded preview payload, which is
 * display-only.
 */
export interface AoTransferSigningInput {
  token: string;
  recipient: string;
  amount: string;
}

/**
 * The subset of `TransferHandler` this handler needs to finalize an
 * approved `transferAoTokens` (or wallet `transfer`) request — injected
 * rather than imported directly, so `ApprovalHandler` doesn't need to know
 * how a transfer is actually submitted (mirrors the existing
 * `StoragePort`/`ApprovalPresenterPort` ports-style injection this class
 * already uses). Optional constructor param: every existing call
 * site/test that never exercises a transfer is unaffected.
 */
export interface AoTransferSubmitter {
  submitTransfer(req: SubmitTransferRequest): Promise<{ txId: string }>;
}

/** The `TransferHandler` steps a hardware wallet's transfer is split into around the device signature. */
export interface DeviceTransferSubmitter {
  prepareDeviceTransfer(req: SubmitTransferRequest, ownerB64Url: string): Promise<UnsignedPayload>;
  /** Posts the transfer and writes its activity entry. */
  finishDeviceTransfer(
    req: SubmitTransferRequest,
    unsigned: UnsignedPayload,
    signature: Uint8Array,
    expectedOwner: string,
  ): Promise<{ txId: string }>;
}

export type TransferSubmitter = AoTransferSubmitter & Partial<DeviceTransferSubmitter>;

/**
 * The `PointsHandler` steps a scan attestation needs. A keyfile signs and
 * submits in one call; a hardware wallet signs in this window, then hands
 * its proof over.
 */
export interface ScanAttestationSubmitter {
  attest(req: { walletId: string; attestation: ParsedAttestation }): Promise<SiteAttestResponse>;
  submitAttestation(attestation: ParsedAttestation, proof: OwnershipProof): Promise<SiteAttestResponse>;
  check(attestation: ParsedAttestation, address?: string): Promise<AttestationCheck>;
}

/**
 * Thrown to whoever awaits a request the user rejected, closed or let time
 * out, as opposed to one that was approved and then failed.
 */
export class ApprovalDeclinedError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "ApprovalDeclinedError";
  }
}

/** A hardware wallet's verified signature over the Gleam Points ownership transaction. */
export interface PointsDeviceProof {
  owner: string;
  address: string;
  signature: string;
}

/** A wallet send handed to the approval window, with the token metadata its preview shows. */
export interface WalletTransferRequest extends SubmitTransferRequest {
  tokenDenomination?: number | null;
  tokenTicker?: string | null;
}

/** The subset of `ReadsHandler` an approved `addToken` request writes through. */
export interface TokenWatchList {
  addWatchedToken(req: { address: string; processId: string }): Promise<unknown>;
}

/** Metadata is resolved by the caller, which has network settings; this handler has none. */
export interface AddTokenRequestInput {
  kind: "addToken";
  address: string;
  processId: string;
  ticker: string | null;
  name: string | null;
}

export interface ConnectRequestInput {
  kind: "connect";
  requestedPermissions: PermissionType[];
  /** Omitted by callers (tests, internal re-grants) that have no dApp-supplied identity. */
  appInfo?: ConnectAppInfo | null;
  /** The requesting tab's favicon, kept on the grant when `appInfo` has no logo. */
  favIconUrl?: string | null;
}

/**
 * A `connect` may arrive before any wallet exists: the approval window
 * runs onboarding first, and the grant goes to whichever wallet is active
 * when the user approves.
 */
export type CreateApprovalInput =
  | ({ origin: string; walletId: string | null } & ConnectRequestInput)
  | ({ origin: string; walletId: string } & SigningRequestInput)
  | ({ origin: string; walletId: string } & AddTokenRequestInput);

/**
 * `result`, `signingInput` and `device.payloads` hold bytes (payloads, AES
 * IVs, signatures), and `chrome.storage` serializes a `Uint8Array` as a
 * plain object. They are written with `toStored` and read with `fromStored`.
 */
interface ApprovalOutcome {
  approved: boolean;
  /** Tagged-binary encoded. */
  result?: unknown;
  error?: string;
}

interface PendingApprovalRecord {
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
  /** Set once a hardware wallet's request is approved and waits for the device. */
  device?: PendingDeviceSigning;
}

/** A byte array in a pending record. */
interface StoredBinary {
  __gleamStored: "ArrayBuffer" | "Uint8Array";
  base64: string;
}

function isStoredBinary(value: unknown): value is StoredBinary {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<StoredBinary>;
  return (
    (candidate.__gleamStored === "ArrayBuffer" || candidate.__gleamStored === "Uint8Array") &&
    typeof candidate.base64 === "string"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bytes go in as base64 rather than the tagged-binary codec's number
 * arrays: `chrome.storage.session` charges every array element as a value
 * of its own, about 32 bytes per byte.
 */
function toStored(value: unknown): unknown {
  // `instanceof` is avoided: WebCrypto results and page values can come from another realm.
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return { __gleamStored: "ArrayBuffer", base64: bytesToBase64(new Uint8Array(value as ArrayBuffer)) } satisfies StoredBinary;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { __gleamStored: "Uint8Array", base64: bytesToBase64(bytes) } satisfies StoredBinary;
  }
  if (Array.isArray(value)) return value.map(toStored);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toStored(entry)]));
  return value;
}

function fromStored(value: unknown): unknown {
  if (isStoredBinary(value)) {
    const bytes = base64ToBytes(value.base64);
    return value.__gleamStored === "ArrayBuffer" ? bytes.buffer : bytes;
  }
  if (Array.isArray(value)) return value.map(fromStored);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fromStored(entry)]));
  return value;
}

const STORED_VALUE_BYTES = 32;

/**
 * `string`'s length once encoded as UTF-8, counted without encoding it.
 * A lone surrogate counts as the 3-byte U+FFFD it is replaced with.
 */
export function utf8ByteLength(string: string): number {
  let bytes = 0;
  for (let i = 0; i < string.length; i += 1) {
    const code = string.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < string.length) {
      const next = string.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Roughly what `chrome.storage.session` charges for `value`: it counts the
 * memory of the stored value tree, a fixed cost per value plus each
 * string's (and key's) UTF-8 length, since Chrome stores strings as UTF-8.
 */
function storedSize(value: unknown): number {
  if (typeof value === "string") return STORED_VALUE_BYTES + utf8ByteLength(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + storedSize(entry), STORED_VALUE_BYTES);
  if (isPlainRecord(value)) {
    return Object.entries(value).reduce<number>(
      (sum, [key, entry]) => sum + utf8ByteLength(key) + storedSize(entry),
      STORED_VALUE_BYTES,
    );
  }
  return STORED_VALUE_BYTES;
}

/*
 * `chrome.storage.session` holds 10 MiB. Pending requests may use 4 MiB of
 * it and one site 2 MiB, so one site can't fill it, and the outcomes and
 * device payloads written onto records before they are dropped still fit.
 */
const PENDING_BYTES_LIMIT = 4 * 1024 * 1024;
const PENDING_BYTES_PER_ORIGIN = 2 * 1024 * 1024;

interface PendingDeviceSigning {
  /** Tagged-binary encoded `UnsignedPayload[]`. */
  payloads: unknown;
  /** Epoch ms. */
  deadline: number;
}

interface HardwareWalletInfo {
  method: HardwareWalletMethod;
  device: HardwareDevice | null;
  address: string;
  publicKey: string;
}

/** Signing kinds a hardware wallet completes with device signatures. */
const DEVICE_SIGNED_KINDS: ReadonlySet<ApprovalKind> = new Set([
  "sign",
  "dispatch",
  "signDataItem",
  "batchSignDataItem",
  "transferAoTokens",
  "transfer",
  "pointsProof",
  "scanAttestation",
  "signMessage",
]);

const WALLET_SWITCHED = "The active wallet changed.";

const SITE_DISCONNECTED = "The site was disconnected.";
const DISCONNECTED_OUTCOME: ApprovalOutcome = { approved: false, error: SITE_DISCONNECTED };

/** Kinds whose only effect is the result handed back: nothing is posted or stored. */
const RESULT_ONLY_KINDS: ReadonlySet<ApprovalKind> = new Set([
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
function needsGrant(entry: PendingApprovalRecord): boolean {
  const kind = entry.request.kind;
  return kind !== "connect" && kind !== "scanAttestation" && entry.request.origin !== WALLET_APPROVAL_ORIGIN;
}

/**
 * A dApp's signing request signs with the wallet that was active when it
 * was made, and its approval shows no account, so it must not outlive that
 * wallet being active. Connect and addToken don't sign, a scan attestation
 * shows and unlocks its own wallet, and Gleam's own requests name theirs.
 */
function signsForActiveWallet(entry: PendingApprovalRecord): boolean {
  const kind = entry.request.kind;
  return (
    kind !== "connect" &&
    kind !== "addToken" &&
    kind !== "scanAttestation" &&
    entry.request.origin !== WALLET_APPROVAL_ORIGIN
  );
}

const TIMED_OUT = userErrorMessage("approvalTimedOut");

/** How soon a timeout looks again at a request that was being resolved when it fired. */
const RESOLVING_RECHECK_MS = 5_000;

const textDecoder = new TextDecoder();

function previewCollectibleId(preview: ApprovalRequest["preview"], index = 0): string | null {
  if ("collectible" in preview && preview.collectible) return preview.collectible.id;
  // A data-item preview names a collectible per item, not at the top level;
  // payloads run in the same order as the items, so the index picks it.
  if ("items" in preview) return preview.items?.[index]?.transfer?.collectible?.id ?? null;
  return null;
}

function plainTags(tags: SigningRequestInput["tags"]): Array<{ name: string; value: string }> {
  return (tags ?? []).map(({ name, value }) => ({ name, value }));
}

/**
 * Re-reads what was prepared against the request the user approved. The
 * transaction builder fetches the anchor after approval; everything else,
 * the reward included, must come out exactly as requested.
 */
function assertPreparedMatches(input: SigningRequestInput, payloads: UnsignedPayload[], address: string): void {
  switch (input.kind) {
    case "sign":
    case "dispatch": {
      const [payload] = payloads;
      if (payload?.kind === "dataItem") {
        checkDataItem(payload, { target: input.target ?? "", tags: plainTags(input.tags), data: input.payload });
      } else {
        checkTransaction(payload, {
          target: input.target ?? "",
          quantity: input.quantity ?? "0",
          tags: plainTags(input.tags),
          data: input.payload,
          reward: input.reward,
        });
      }
      return;
    }
    case "signDataItem":
    case "batchSignDataItem": {
      const items = input.kind === "signDataItem" ? (input.dataItems ?? []).slice(0, 1) : (input.dataItems ?? []);
      if (payloads.length !== items.length) mismatch("item count");
      items.forEach((item, index) =>
        checkDataItem(payloads[index], {
          target: item.target ?? "",
          tags: plainTags(item.tags),
          data: base64ToBytes(item.data),
          anchor: item.anchor ?? "",
        }),
      );
      return;
    }
    case "transferAoTokens":
    case "transfer":
      assertTransferMatches(
        {
          recipient: input.recipient ?? "",
          amount: input.amount ?? "",
          token: input.token ?? null,
          fee: input.fee ?? "",
          // Only a wallet `transfer` of a collectible is an L1 transaction
          // carrying the collectible tags. A `transferAoTokens` of one is
          // an AO data item, so its `collectible` is display-only: passing
          // it here would check the data item as an L1 transaction and
          // refuse every approved collectible AO transfer.
          collectible: input.kind === "transfer" ? input.collectible : undefined,
        },
        payloads[0],
      );
      return;
    case "signMessage": {
      const [payload] = payloads;
      if (payloads.length !== 1 || payload?.kind !== "message") mismatch("message");
      if (bytesToBase64Url(payload.data) !== bytesToBase64Url(input.payload)) mismatch("message");
      return;
    }
    case "pointsProof":
    case "scanAttestation":
      checkTransaction(payloads[0], {
        target: address,
        quantity: "0",
        tags: [{ name: POINTS_PROOF_TAG, value: textDecoder.decode(input.payload) }],
        data: new Uint8Array(),
        reward: "0",
      });
      return;
    case "encrypt":
    case "decrypt":
      // Nothing is signed, so there are no prepared bytes to read back.
      return;
    default: {
      const unchecked: never = input.kind;
      throw new Error(dappError(`No prepared-bytes check for ${String(unchecked)}.`));
    }
  }
}

/** The stored attestation, checked again: the brand doesn't survive storage. */
function parsedAttestationOf(input: SigningRequestInput): ParsedAttestation {
  const parsed = parseAttestation(input.attestation);
  if (!parsed.ok) throw new Error(userErrorMessage("attestationInvalid"));
  return parsed.attestation;
}

function toWirePayload(payload: UnsignedPayload): DeviceSigningPayload {
  switch (payload.kind) {
    case "transaction":
      return { kind: "transaction", transaction: payload.transaction };
    case "dataItem":
      return { kind: "dataItem", raw: bytesToBase64Url(payload.raw) };
    case "message":
      return { kind: "message", data: bytesToBase64Url(payload.data) };
  }
}

function validGrants(raw: unknown): Grant[] {
  return Array.isArray(raw) ? raw.filter(isValidGrant) : [];
}

function validPending(raw: unknown): PendingApprovalRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PendingApprovalRecord =>
      entry !== null &&
      typeof entry === "object" &&
      isValidApprovalRequest((entry as PendingApprovalRecord).request) &&
      (typeof (entry as PendingApprovalRecord).walletId === "string" ||
        (entry as PendingApprovalRecord).walletId === null),
  );
}

function transactionInputOf(input: SigningRequestInput): SignTransactionInput {
  return {
    data: bytesToBase64(input.payload),
    target: input.target,
    quantity: input.quantity,
    tags: input.tags,
    reward: input.reward,
    last_tx: input.last_tx,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/*
 * The window shows the start of the text; the payload and `payloadHash`
 * still cover every byte. A full copy would be stored a second time
 * beside the payload and count against `PENDING_BYTES_PER_ORIGIN`.
 */
const DATA_PREVIEW_CHARS = 4096;

function decodeDataPreview(payload: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return null;
  }
  if (text.length <= DATA_PREVIEW_CHARS) return text;
  const cut = /[\uD800-\uDBFF]/.test(text[DATA_PREVIEW_CHARS - 1]!) ? DATA_PREVIEW_CHARS - 1 : DATA_PREVIEW_CHARS;
  return `${text.slice(0, cut)}…`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildAddTokenPreview(input: AddTokenRequestInput): AddTokenApprovalPreview {
  return {
    kind: "addToken",
    processId: input.processId,
    ticker: input.ticker,
    name: input.name,
    address: input.address,
  };
}

/** What the window shows is derived from the attestation, and the message it signs must be the one for it. */
async function buildScanAttestationPreview(
  input: SigningRequestInput & { walletId: string },
): Promise<ScanAttestationApprovalPreview> {
  if (!input.address) throw new Error(dappError("A scan attestation request needs its signing wallet."));
  const attestation = parsedAttestationOf(input);
  const id = await attestationId(attestation);
  const message = buildAttestMessage(attestation.release, id);
  if (textDecoder.decode(input.payload) !== message) {
    throw new Error(userErrorMessage("attestationMessageMismatch"));
  }
  return {
    kind: "scanAttestation",
    walletId: input.walletId,
    address: input.address,
    attestationId: id,
    message,
    release: attestation.release,
    commit: attestation.commit,
    model: attestation.model,
    challenge: attestation.challenge,
    result: attestation.result,
    answers: attestation.answers,
    report: attestation.report,
  };
}

function buildConnectPreview(
  requestedPermissions: PermissionType[],
  appInfo: ConnectAppInfo | null,
): ConnectApprovalPreview {
  // The approval window would fetch the page's logo as given, so it gets the
  // same filter as the icon kept on the grant: no plaintext http fetch.
  return { kind: "connect", requestedPermissions, appInfo: appInfo && { ...appInfo, logo: safeSiteIconUrl(appInfo.logo) } };
}

/**
 * `signDataItem`/`batchSignDataItem` carry every item in `input.dataItems`
 * (`input.payload`/`input.tags` are only item 1's, kept for every other
 * kind's single-payload preview) — decodes each one so the approval window
 * can list them all rather than showing item 1 while the rest sign unseen.
 */
async function buildDataItemPreviews(
  dataItems: NonNullable<SigningRequestInput["dataItems"]>,
  tokenMetadata: SigningRequestInput["itemTokenMetadata"],
): Promise<SigningApprovalPreview["items"]> {
  return Promise.all(
    dataItems.map(async (item, index) => {
      const bytes = base64ToBytes(item.data);
      const tags = item.tags ?? [];
      const transfer = readAoTransferMessage({ target: item.target, tags });
      const metadata = tokenMetadata?.[index] ?? null;
      // A collectible's transfer of 1 shows as that collectible, as the
      // L1 path already does, not as 1 raw unit of an unknown token.
      const collectible =
        transfer?.kind === "transfer" && metadata?.collectible && transfer.quantity === COLLECTIBLE_TRANSFER_QUANTITY
          ? { id: transfer.processId }
          : null;
      return {
        decodedData: decodeDataPreview(bytes),
        tags,
        target: item.target ?? null,
        payloadHash: await sha256Hex(bytes),
        transfer:
          transfer?.kind === "transfer"
            ? {
                token: transfer.processId,
                recipient: transfer.recipient,
                amount: transfer.quantity,
                tokenDenomination: metadata?.tokenDenomination ?? null,
                tokenTicker: metadata?.tokenTicker ?? null,
                ...(collectible ? { collectible } : {}),
              }
            : null,
        ...(transfer?.kind === "unreadable" ? { unreadableTokenTransfer: true } : {}),
      };
    }),
  );
}

async function buildSigningPreview(input: SigningRequestInput): Promise<SigningApprovalPreview> {
  if (input.kind === "scanAttestation") throw new Error(dappError("A scan attestation has its own preview."));
  const payloadHash = await sha256Hex(input.payload);
  const signedItems =
    input.kind === "signDataItem"
      ? input.dataItems?.slice(0, 1)
      : input.kind === "batchSignDataItem"
        ? input.dataItems
        : undefined;
  return {
    kind: input.kind,
    recipient: input.recipient ?? null,
    amount: input.amount ?? null,
    fee: input.fee ?? null,
    token: input.token ?? null,
    tokenDenomination: input.tokenDenomination ?? null,
    tokenTicker: input.tokenTicker ?? null,
    ...(input.collectible ? { collectible: input.collectible } : {}),
    ...(input.unreadableTokenTransfer ? { unreadableTokenTransfer: true } : {}),
    decodedData: decodeDataPreview(input.payload),
    tags: input.tags ?? [],
    payloadHash,
    items: signedItems ? await buildDataItemPreviews(signedItems, input.itemTokenMetadata) : null,
  };
}

export class ApprovalHandler {
  /**
   * Requests `resolveApproval` is finishing. Dismissing the approval UI while an
   * approved request signs or posts must not also report it as rejected.
   */
  private readonly resolving = new Set<string>();

  /** Set while a scan attestation is being opened or awaited, so two can't race past the pending check. */
  private attesting = false;

  constructor(
    private readonly storage: StoragePort,
    private readonly keySession: Pick<KeySession, "getSigner" | "getWalletMethod" | "getStoredWallet">,
    private readonly presenter: ApprovalPresenterPort,
    private readonly transfers?: TransferSubmitter,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
    private readonly activeWalletId: () => Promise<string | null> = async () => null,
    private readonly tokens?: TokenWatchList,
    private readonly attestations?: ScanAttestationSubmitter,
  ) {
    presenter.onDismissed((requestId) => {
      void this.rejectDismissed(requestId);
    });
  }

  private async loadGrants(): Promise<Grant[]> {
    return validGrants(await this.storage.get<unknown>(GRANTS_KEY));
  }

  /** The only way to write grants. `update` sees the current grants and returns the new ones. */
  private async updateGrants<R>(update: (grants: Grant[]) => { next: Grant[] | null; result: R }): Promise<R> {
    let result!: R;
    await updateStored(this.storage, GRANTS_KEY, (raw) => {
      const outcome = update(validGrants(raw));
      result = outcome.result;
      return outcome.next;
    });
    return result;
  }

  /** Past its deadline with nothing settling it. A request being resolved runs to completion. */
  private pastDeadline(entry: PendingApprovalRecord): boolean {
    if (entry.outcome) return false;
    const deadline = entry.device?.deadline ?? entry.request.createdAt + reviewTimeoutMs(entry.request.kind);
    return Date.now() > deadline;
  }

  private isStale(entry: PendingApprovalRecord): boolean {
    return !this.resolving.has(entry.request.requestId) && this.pastDeadline(entry);
  }

  /** Live records only; see the class comment on deadlines. */
  private async loadPending(): Promise<PendingApprovalRecord[]> {
    return (await this.loadAllPending()).filter((entry) => !this.isStale(entry));
  }

  private async loadAllPending(): Promise<PendingApprovalRecord[]> {
    return validPending(await this.storage.get<unknown>(PENDING_APPROVALS_KEY));
  }

  /**
   * The only way to write pending approvals. `update` sees the current
   * records, stale ones included so a timeout can attach its outcome, and
   * returns the new ones, or `null` to leave storage untouched. Stale
   * records are pruned from what is written.
   */
  private async updatePending(
    update: (pending: PendingApprovalRecord[]) => PendingApprovalRecord[] | null,
  ): Promise<void> {
    await updateStored(this.storage, PENDING_APPROVALS_KEY, (raw) => {
      const next = update(validPending(raw));
      return next ? next.filter((entry) => !this.isStale(entry)) : undefined;
    });
  }

  /**
   * Origin -> wallet permission lookup. A connected origin's Grant must
   * still be present and unexpired for a `PROVIDER_METHODS` call to
   * proceed without a fresh approval prompt — revoking a Grant (or
   * letting it expire) ends all access it covered, including requests
   * still waiting in an approval window (`revokeGrant`, `grantLapsed`).
   */
  async findActiveGrant(origin: string): Promise<Grant | null> {
    return activeGrant(await this.loadGrants(), origin);
  }

  /**
   * Creates a pending `ApprovalRequest`, shows its own approval UI
   * (never inline in the popup), and resolves once `resolveApproval` has
   * been called for it. Rejects on
   * explicit rejection or on timeout (a hung/abandoned approval UI
   * must not hang the calling dApp forever).
   */
  async requestApproval(input: CreateApprovalInput): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const preview: ApprovalPreview =
      input.kind === "connect"
        ? buildConnectPreview(input.requestedPermissions, input.appInfo ?? null)
        : input.kind === "addToken"
          ? buildAddTokenPreview(input)
          : input.kind === "scanAttestation"
            ? await buildScanAttestationPreview(input)
            : await buildSigningPreview(input);

    const request: ApprovalRequest = {
      requestId,
      kind: input.kind,
      origin: input.origin,
      createdAt: Date.now(),
      preview,
    };

    const record: PendingApprovalRecord = {
      request,
      walletId: input.walletId,
      signingInput: input.kind === "connect" ? null : toStored(input),
      ...(input.kind === "connect"
        ? { siteIcon: safeSiteIconUrl(input.appInfo?.logo) ?? safeSiteIconUrl(input.favIconUrl) }
        : {}),
    };
    // Gleam's own requests sit outside the dApp pool, so sites filling it
    // can't block a hardware send or a scan attestation.
    const fromSite = input.origin !== WALLET_APPROVAL_ORIGIN;
    const size = fromSite ? storedSize(record) : 0;
    if (size > PENDING_BYTES_PER_ORIGIN) {
      throw new Error(dappError("Gleam refused this request because it is too large to hold for approval."));
    }
    await this.updatePending((pending) => {
      if (!fromSite) return [...pending, record];
      const live = pending.filter((entry) => !this.isStale(entry) && entry.request.origin !== WALLET_APPROVAL_ORIGIN);
      const total = live.reduce((sum, entry) => sum + storedSize(entry), size);
      const fromOrigin = live
        .filter((entry) => entry.request.origin === input.origin)
        .reduce((sum, entry) => sum + storedSize(entry), size);
      if (total > PENDING_BYTES_LIMIT || fromOrigin > PENDING_BYTES_PER_ORIGIN) {
        throw new Error(dappError("Gleam refused this request because too many requests are waiting for approval."));
      }
      return [...pending, record];
    });
    // The preview is built after the caller read the active wallet, so a
    // switch can land in between. `switchWallet` sets the new wallet before
    // `rejectSwitchedApprovals` scans, so a record stored too late for that
    // scan sees the new wallet here. No active wallet means none is left,
    // which already rejects every pending request.
    if (signsForActiveWallet(record)) {
      let active: string | null;
      try {
        active = await this.activeWalletId();
      } catch (error) {
        await this.dropPending(requestId);
        throw error;
      }
      if (active !== null && active !== record.walletId) {
        await this.dropPending(requestId);
        throw new Error(WALLET_SWITCHED);
      }
    }

    // Watch before presenting: a switch landing while the window opens
    // writes its rejection then, and a later watcher would miss it.
    const resolution = this.awaitResolution(requestId, input.kind);
    try {
      await this.presenter.present(requestId);
    } catch (error) {
      resolution.catch(() => {});
      await this.dropPending(requestId);
      throw error;
    }
    return resolution;
  }

  /**
   * Resolves once `resolveApproval` has written an `outcome` onto this
   * request's pending record (observed via `StoragePort.watch`, which
   * fires with the full new array on every write — including the
   * one-tick write `resolveApproval` makes just before removing the
   * record), or rejects on timeout.
   */
  private async awaitResolution(requestId: string, kind: ApprovalRequest["kind"]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const expireAt = (at: number) => {
        timeout = setTimeout(() => void expire(), Math.max(0, at - Date.now()));
      };
      // A request waiting on a device runs to its own, extendable deadline.
      const expire = async () => {
        if (this.resolving.has(requestId)) {
          expireAt(Date.now() + RESOLVING_RECHECK_MS);
          return;
        }
        const entry = (await this.loadAllPending()).find((candidate) => candidate.request.requestId === requestId);
        if (entry?.outcome) return;
        const deadline = entry?.device?.deadline;
        if (deadline !== undefined && deadline > Date.now()) {
          expireAt(deadline);
          return;
        }
        unwatch();
        void this.dropPending(requestId);
        void this.presenter.dismiss(requestId);
        reject(new ApprovalDeclinedError(TIMED_OUT, true));
      };
      expireAt(Date.now() + reviewTimeoutMs(kind));

      const unwatch = this.storage.watch<PendingApprovalRecord[]>(PENDING_APPROVALS_KEY, (value) => {
        const entry = (value ?? []).find((candidate) => candidate.request.requestId === requestId);
        if (!entry?.outcome) return;

        clearTimeout(timeout);
        unwatch();
        const { outcome } = entry;
        if (!outcome.approved) {
          reject(new ApprovalDeclinedError(outcome.error ?? "The request was rejected.", outcome.error === TIMED_OUT));
        } else if (outcome.error) {
          reject(new Error(outcome.error));
        } else {
          resolve(fromStored(outcome.result));
        }
      });
    });
  }

  /**
   * Also drops a record left behind by a service worker that restarted
   * while its approval UI was up, even though nothing is awaiting it.
   */
  private async rejectDismissed(requestId: string): Promise<void> {
    const outcome: ApprovalOutcome = { approved: false, error: "The approval was dismissed." };
    let rejected = false;
    await this.updatePending((pending) => {
      if (this.resolving.has(requestId)) return null;
      if (!pending.some((entry) => entry.request.requestId === requestId && !entry.outcome)) return null;
      rejected = true;
      return pending.map((entry) => (entry.request.requestId === requestId ? { ...entry, outcome } : entry));
    });
    if (rejected) await this.dropPending(requestId);
  }

  private dropPending(requestId: string): Promise<void> {
    return this.updatePending((pending) => pending.filter((entry) => entry.request.requestId !== requestId));
  }

  private async findPending(requestId: string): Promise<PendingApprovalRecord> {
    const pending = await this.loadPending();
    const entry = pending.find((candidate) => candidate.request.requestId === requestId);
    if (!entry) {
      throw new Error(userErrorMessage("approvalNotPending", { id: requestId }));
    }
    return entry;
  }

  /**
   * Like `findPending`, but a record past its deadline is timed out here,
   * rejecting whoever still awaits it, rather than just hidden. `owned`
   * is set when the caller has already claimed the request in `resolving`.
   */
  private async findLive(requestId: string, owned: boolean): Promise<PendingApprovalRecord> {
    const entry = (await this.loadAllPending()).find((candidate) => candidate.request.requestId === requestId);
    if (!entry || entry.outcome) {
      throw new Error(userErrorMessage("approvalNotPending", { id: requestId }));
    }
    if (this.pastDeadline(entry) && (owned || !this.resolving.has(requestId))) {
      await this.timeOut(requestId);
    }
    return entry;
  }

  private async timeOut(requestId: string): Promise<never> {
    const outcome: ApprovalOutcome = { approved: false, error: TIMED_OUT };
    await this.updatePending((current) =>
      current.map((candidate) =>
        candidate.request.requestId === requestId && !candidate.outcome ? { ...candidate, outcome } : candidate,
      ),
    );
    await this.dropPending(requestId);
    await this.presenter.dismiss(requestId);
    throw new Error(TIMED_OUT);
  }

  /** `ProtocolMap.getApproval` — read-only, called by the approval UI on mount. */
  async getApproval(req: { requestId: string }): Promise<ApprovalRequest> {
    return this.requestView(await this.findPending(req.requestId));
  }

  /** The request as the approval UI sees it: with the device's payloads once it waits on one. */
  private async requestView(entry: PendingApprovalRecord): Promise<ApprovalRequest> {
    const { origin, kind } = entry.request;
    const siteIcon =
      origin === WALLET_APPROVAL_ORIGIN || kind === "connect" ? null : ((await this.findActiveGrant(origin))?.icon ?? null);
    const request = siteIcon ? { ...entry.request, siteIcon } : entry.request;
    if (!entry.device || !entry.walletId) return request;
    const wallet = await this.hardwareWallet(entry.walletId);
    const payloads = fromStored(entry.device.payloads) as UnsignedPayload[];
    return {
      ...request,
      device: {
        ...wallet,
        payloads: payloads.map(toWirePayload),
        summaries: payloads.map((payload, index) => summarize(payload, previewCollectibleId(entry.request.preview, index))),
        deadline: entry.device.deadline,
      },
    };
  }

  /**
   * `ProtocolMap.resolveApproval` — called only from the approval UI
   * (`APPROVAL_METHODS`, enforced by the dispatcher choke point, not by
   * this handler). On a `connect` approval, creates and persists a real
   * `Grant`. On a signing approval, performs the actual signing operation
   * using the signing key `key-session.ts` cached at unlock (no password
   * staging step needed any more — see this class's doc comment on why
   * `unlockApprovalWallet` existed and `wallet-lifecycle.ts`'s doc comment
   * for the superseding session-cache decision) and returns the result to
   * the original caller, then takes the approval UI down.
   *
   * If an approved request fails (locked wallet, network error), the dApp
   * is rejected with that error and this call throws it too. The window
   * stays open so the user sees why instead of a success message.
   */
  async resolveApproval(req: { requestId: string; approved: boolean }): Promise<ApprovalRequest | ApprovalShown | void> {
    const entry = await this.findPending(req.requestId);
    if (this.resolving.has(req.requestId)) {
      throw new Error(userErrorMessage("approvalResolving", { id: req.requestId }));
    }
    if (req.approved && entry.device) {
      throw new Error(userErrorMessage("approvalAwaitingDevice"));
    }
    this.resolving.add(req.requestId);
    try {
      let outcome: ApprovalOutcome;
      let result: unknown;
      if (!req.approved) {
        outcome = { approved: false };
      } else {
        if (await this.grantLapsed(entry)) return await this.complete(entry, DISCONNECTED_OUTCOME, undefined);
        try {
          if (await this.signsOnDevice(entry)) {
            const view = await this.startDeviceSigning(entry);
            if (!(await this.lapsedSince(entry))) return view;
            outcome = DISCONNECTED_OUTCOME;
          } else {
            result = await this.finalizeApproval(entry);
            outcome = await this.withheldIfLapsed(entry, { approved: true, result: toStored(result) });
          }
        } catch (error) {
          outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
        }
      }
      return await this.complete(entry, outcome, result);
    } finally {
      this.resolving.delete(req.requestId);
    }
  }

  /**
   * Hands the outcome to whoever awaits the request, drops it, and closes
   * its window. A failed outcome throws instead, leaving the window open
   * to show why. A scan attestation keeps its window open too, and its
   * result is returned for the window to show.
   */
  private async complete(
    entry: PendingApprovalRecord,
    outcome: ApprovalOutcome,
    result: unknown,
  ): Promise<ApprovalShown | void> {
    const { requestId } = entry.request;
    // Written in two steps (outcome attached, then removed) so a watcher
    // observing this key sees the outcome at least once before the record
    // disappears — see this class's doc comment.
    await this.updatePending((current) =>
      current.map((candidate) => (candidate.request.requestId === requestId ? { ...candidate, outcome } : candidate)),
    );
    await this.dropPending(requestId);
    if (outcome.error !== undefined) {
      // Ended for the user rather than failed: nothing is left to show.
      if (!outcome.approved) await this.presenter.dismiss(requestId);
      throw new Error(outcome.error);
    }
    if (outcome.approved && entry.request.kind === "scanAttestation") {
      return { shown: "scanAttestation", result: result as SiteAttestResponse };
    }
    await this.presenter.dismiss(requestId);
  }

  /** The site's grant was revoked or expired after it made this request. */
  private async grantLapsed(entry: PendingApprovalRecord): Promise<boolean> {
    return needsGrant(entry) && (await this.findActiveGrant(entry.request.origin)) === null;
  }

  /**
   * `grantLapsed` once the request's work is done. A revoke landing during
   * it skipped the record, since it was resolving. A failed read keeps
   * what was done rather than leave the request without an outcome.
   */
  private async lapsedSince(entry: PendingApprovalRecord): Promise<boolean> {
    try {
      return await this.grantLapsed(entry);
    } catch {
      return false;
    }
  }

  /**
   * Withholds a signature or plaintext from a site that lost its grant
   * while it was made. A request that already posted or stored something
   * keeps its real outcome, so the site doesn't retry and send twice.
   */
  private async withheldIfLapsed(entry: PendingApprovalRecord, outcome: ApprovalOutcome): Promise<ApprovalOutcome> {
    if (!RESULT_ONLY_KINDS.has(entry.request.kind)) return outcome;
    return (await this.lapsedSince(entry)) ? DISCONNECTED_OUTCOME : outcome;
  }

  private async signsOnDevice(entry: PendingApprovalRecord): Promise<boolean> {
    if (!entry.walletId || !DEVICE_SIGNED_KINDS.has(entry.request.kind)) return false;
    const method = await this.keySession.getWalletMethod(entry.walletId);
    return method !== null && isHardwareWalletMethod(method);
  }

  /**
   * The earliest of another idle window from now and the request's hard
   * cap. The cap gives the device the same time past the kind's own
   * review timeout that a dApp request gets past `APPROVAL_TIMEOUT_MS`,
   * so a scan attestation approved late in its longer review still gets
   * that time. For a dApp request it stays `APPROVAL_MAX_MS` from
   * creation, which the page's own timeout is sized to.
   */
  private deviceDeadline(request: ApprovalRequest): number {
    const cap = reviewTimeoutMs(request.kind) + DEVICE_GRACE_MS;
    return Math.min(Date.now() + APPROVAL_TIMEOUT_MS, request.createdAt + cap);
  }

  private async startDeviceSigning(entry: PendingApprovalRecord): Promise<ApprovalRequest> {
    const input = this.signingInputOf(entry);
    const walletId = entry.walletId!;
    const wallet = await this.hardwareWallet(walletId);
    const payloads = await this.prepareDevicePayloads(walletId, wallet, input);
    assertPreparedMatches(input, payloads, wallet.address);
    const device: PendingDeviceSigning = {
      payloads: toStored(payloads),
      deadline: this.deviceDeadline(entry.request),
    };
    const requestId = entry.request.requestId;
    let stillPending = false;
    await this.updatePending((current) => {
      stillPending = current.some((candidate) => candidate.request.requestId === requestId && !candidate.outcome);
      if (!stillPending) return null;
      return current.map((candidate) => (candidate.request.requestId === requestId ? { ...candidate, device } : candidate));
    });
    if (!stillPending) {
      throw new Error(userErrorMessage("approvalEndedPreparing"));
    }
    return this.requestView({ ...entry, device });
  }

  /** `ProtocolMap.checkScanAttestation`. */
  async checkScanAttestation(req: { requestId: string }): Promise<AttestationCheck> {
    const entry = await this.findLive(req.requestId, false);
    if (entry.request.kind !== "scanAttestation") {
      throw new Error(dappError(`Approval request "${req.requestId}" isn't a scan attestation.`));
    }
    const wallet = entry.walletId ? await this.keySession.getStoredWallet(entry.walletId) : null;
    return this.attestationSubmitter().check(parsedAttestationOf(this.signingInputOf(entry)), wallet?.address);
  }

  /** `ProtocolMap.deviceActivity`. */
  async deviceActivity(req: { requestId: string }): Promise<{ deadline: number }> {
    const entry = await this.findLive(req.requestId, false);
    if (!entry.device) {
      throw new Error(userErrorMessage("approvalNotWaitingForDevice", { id: req.requestId }));
    }
    const deadline = this.deviceDeadline(entry.request);
    await this.updatePending((current) =>
      current.map((candidate) =>
        candidate.request.requestId === req.requestId && candidate.device
          ? { ...candidate, device: { ...candidate.device, deadline } }
          : candidate,
      ),
    );
    return { deadline };
  }

  /**
   * `ProtocolMap.submitDeviceSignature`. Every signature is verified
   * before any is applied, so a wrong one throws with nothing posted and
   * the request still waiting. Once they verify, the request completes:
   * a later failure (a gateway refusing the transaction) rejects the
   * dApp, as it does for a keyfile wallet.
   */
  async submitDeviceSignature(req: { requestId: string; signatures: string[] }): Promise<ApprovalShown | void> {
    if (this.resolving.has(req.requestId)) {
      throw new Error(userErrorMessage("approvalResolving", { id: req.requestId }));
    }
    this.resolving.add(req.requestId);
    try {
      const entry = await this.findLive(req.requestId, true);
      if (!entry.device || !entry.walletId) {
        throw new Error(userErrorMessage("approvalNotWaitingForSignature", { id: req.requestId }));
      }
      if (await this.grantLapsed(entry)) return await this.complete(entry, DISCONNECTED_OUTCOME, undefined);
      const walletId = entry.walletId;
      const payloads = fromStored(entry.device.payloads) as UnsignedPayload[];
      const wallet = await this.hardwareWallet(walletId);
      const signatures = await this.verifiedSignatures(payloads, req.signatures, wallet.publicKey);

      let outcome: ApprovalOutcome;
      let result: unknown;
      try {
        result = await this.finishDeviceSigning(walletId, wallet, this.signingInputOf(entry), payloads, signatures);
        outcome = await this.withheldIfLapsed(entry, { approved: true, result: toStored(result) });
      } catch (error) {
        outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
      }
      return await this.complete(entry, outcome, result);
    } finally {
      this.resolving.delete(req.requestId);
    }
  }

  private async verifiedSignatures(
    payloads: UnsignedPayload[],
    encoded: string[],
    publicKey: string,
  ): Promise<Uint8Array[]> {
    if (!Array.isArray(encoded) || encoded.length !== payloads.length) {
      throw new Error(userErrorMessage("deviceSignatureCount", { expected: payloads.length, received: encoded?.length ?? 0 }));
    }
    const signatures = encoded.map((value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error(userErrorMessage("deviceSignatureEncoding"));
      }
      return base64UrlToBytes(value);
    });
    for (const [index, payload] of payloads.entries()) {
      if (!(await verifyDeviceSignature(payload, signatures[index]!, publicKey))) {
        throw new Error(
          userErrorMessage("deviceSignatureMismatch"),
        );
      }
    }
    return signatures;
  }

  private signingInputOf(entry: PendingApprovalRecord): SigningRequestInput {
    const input = fromStored(entry.signingInput) as SigningRequestInput | null;
    if (!input) {
      throw new Error(dappError(`Approval request "${entry.request.requestId}" has no signing input.`));
    }
    return input;
  }

  /**
   * The hardware wallet's public fields. Its stored key must hash to its
   * address, so a tampered record can't make the device sign as, or
   * verify against, some other owner.
   */
  private async hardwareWallet(walletId: string): Promise<HardwareWalletInfo> {
    const wallet = await this.keySession.getStoredWallet(walletId);
    if (!wallet || !isHardwareWalletMethod(wallet.method) || wallet.publicKey.length === 0) {
      throw new Error(userErrorMessage("notHardwareWallet", { wallet: walletId }));
    }
    if ((await addressFromOwner(wallet.publicKey)) !== wallet.address) {
      throw new Error(userErrorMessage("storedKeySigningMismatch"));
    }
    return { method: wallet.method, device: wallet.device ?? null, address: wallet.address, publicKey: wallet.publicKey };
  }

  /**
   * What a dApp's sign, dispatch or data-item request will sign, for any
   * wallet kind. `method` decides whether a large dispatch can bundle.
   */
  private async prepareDappPayloads(
    owner: string,
    method: WalletMethod,
    input: SigningRequestInput,
  ): Promise<UnsignedPayload[]> {
    switch (input.kind) {
      case "sign":
        return [
          {
            kind: "transaction",
            transaction: await prepareSignTransaction(this.requireGatewayUrl(input), owner, transactionInputOf(input)),
          },
        ];
      case "dispatch": {
        const { dispatchViaBundler: viaBundler } = capabilitiesFor(method);
        return [await prepareDispatch(this.requireGatewayUrl(input), owner, transactionInputOf(input), { viaBundler })];
      }
      case "signDataItem": {
        const [dataItem] = input.dataItems ?? [];
        if (!dataItem) throw new Error(dappError("signDataItem requires a data item."));
        return [{ kind: "dataItem", raw: prepareDataItem(owner, dataItem) }];
      }
      case "batchSignDataItem": {
        const items = input.dataItems ?? [];
        if (items.length === 0) throw new Error(dappError("batchSignDataItem requires at least one data item."));
        return prepareDataItems(owner, items).map((raw) => ({ kind: "dataItem", raw }));
      }
      default:
        throw new Error(dappError(`"${input.kind}" isn't a dApp signing request.`));
    }
  }

  /** Applies the signatures to `prepareDappPayloads`' result and returns what the dApp gets. */
  private async finishDappPayloads(
    owner: string,
    input: SigningRequestInput,
    payloads: UnsignedPayload[],
    signatures: Uint8Array[],
  ): Promise<unknown> {
    const [payload] = payloads;
    const [signature] = signatures;
    switch (input.kind) {
      case "sign":
        return finishSignTransaction(transactionOf(payload).transaction, signature!, owner);
      case "dispatch":
        return finishDispatch(this.requireGatewayUrl(input), input.bundlerUrl ?? this.bundlerUrl, payload!, signature!, owner);
      case "signDataItem":
        // Wander resolves to the raw signed item as an ArrayBuffer, which
        // aoconnect's createDataItemSigner parses directly.
        return toArrayBuffer(await finishDataItem(dataItemOf(payload), signature!, owner));
      case "batchSignDataItem":
        return (await finishDataItems(payloads.map(dataItemOf), signatures, owner)).map(toArrayBuffer);
      default:
        throw new Error(dappError(`"${input.kind}" isn't a dApp signing request.`));
    }
  }

  private async prepareDevicePayloads(
    walletId: string,
    wallet: HardwareWalletInfo,
    input: SigningRequestInput,
  ): Promise<UnsignedPayload[]> {
    const owner = wallet.publicKey;
    switch (input.kind) {
      case "sign":
      case "dispatch":
      case "signDataItem":
      case "batchSignDataItem":
        return this.prepareDappPayloads(owner, wallet.method, input);
      case "transferAoTokens":
      case "transfer":
        return [await this.deviceTransfers().prepareDeviceTransfer(this.transferRequestOf(walletId, input), owner)];
      case "pointsProof":
      case "scanAttestation":
        return [{ kind: "transaction", transaction: await buildOwnershipTransaction(owner, textDecoder.decode(input.payload)) }];
      case "signMessage": {
        const hashAlgorithm = input.hashAlgorithm ?? HARDWARE_MESSAGE_HASH;
        if (hashAlgorithm !== HARDWARE_MESSAGE_HASH) {
          throw new Error(dappError(`A hardware wallet signs messages with ${HARDWARE_MESSAGE_HASH} only, not ${hashAlgorithm}.`));
        }
        return [{ kind: "message", data: new Uint8Array(input.payload) }];
      }
      default:
        throw new Error(dappError(`A hardware wallet can't sign "${input.kind}" requests.`));
    }
  }

  private async finishDeviceSigning(
    walletId: string,
    wallet: HardwareWalletInfo,
    input: SigningRequestInput,
    payloads: UnsignedPayload[],
    signatures: Uint8Array[],
  ): Promise<unknown> {
    const owner = wallet.publicKey;
    const [payload] = payloads;
    const [signature] = signatures;
    switch (input.kind) {
      case "sign":
      case "dispatch":
      case "signDataItem":
      case "batchSignDataItem":
        return this.finishDappPayloads(owner, input, payloads, signatures);
      case "transferAoTokens":
      case "transfer": {
        const { txId } = await this.deviceTransfers().finishDeviceTransfer(
          this.transferRequestOf(walletId, input),
          payload!,
          signature!,
          owner,
        );
        // A dApp's transferAoTokens resolves to `{ id }`; a wallet send to `submitTransfer`'s `{ txId }`.
        return input.kind === "transfer" ? { txId } : { id: txId };
      }
      case "pointsProof":
        return { owner, address: wallet.address, signature: bytesToBase64Url(signature!) } satisfies PointsDeviceProof;
      case "scanAttestation":
        return this.attestationSubmitter().submitAttestation(parsedAttestationOf(input), {
          owner,
          address: wallet.address,
          message: textDecoder.decode(input.payload),
          signature: bytesToBase64Url(signature!),
          proof: "transaction",
        });
      case "signMessage":
        return new Uint8Array(signature!);
      default:
        throw new Error(dappError(`A hardware wallet can't sign "${input.kind}" requests.`));
    }
  }

  private deviceTransfers(): DeviceTransferSubmitter {
    const transfers = this.transfers;
    if (!transfers?.prepareDeviceTransfer || !transfers.finishDeviceTransfer) {
      throw new Error(dappError("Hardware wallet transfers aren't wired. ApprovalHandler was constructed without them."));
    }
    return transfers as DeviceTransferSubmitter;
  }

  private transferRequestOf(walletId: string, input: SigningRequestInput): SubmitTransferRequest {
    if (input.recipient == null || input.amount == null) {
      throw new Error(dappError(`A ${input.kind} approval is missing its recipient or amount.`));
    }
    if (input.kind === "transferAoTokens" && input.token == null) {
      throw new Error(dappError("A transferAoTokens approval is missing its token."));
    }
    return {
      token: input.token ?? null,
      recipient: input.recipient,
      amount: input.amount,
      fee: input.fee ?? null,
      walletId,
      ...(input.kind === "transfer" && input.collectible ? { collectible: input.collectible } : {}),
    };
  }

  /**
   * A send from the popup by a hardware wallet: reviewed and signed in the
   * approval window like a dApp's request, with Gleam as the origin.
   * Resolves to `submitTransfer`'s `{ txId }` once the transfer is posted.
   */
  async requestWalletTransfer(req: WalletTransferRequest): Promise<{ txId: string }> {
    const result = await this.requestApproval({
      kind: "transfer",
      origin: WALLET_APPROVAL_ORIGIN,
      walletId: req.walletId,
      recipient: req.recipient,
      amount: req.amount,
      fee: req.fee,
      token: req.token,
      tokenDenomination: req.tokenDenomination ?? null,
      tokenTicker: req.tokenTicker ?? null,
      collectible: req.collectible ?? null,
      payload: new Uint8Array(),
      tags: [],
    });
    return result as { txId: string };
  }

  /**
   * Has a hardware wallet sign the Gleam Points ownership transaction for
   * `message` (`core/points/ownership.ts`) in the approval window. Resolves
   * once the device's signature has verified against the wallet's key.
   */
  async requestPointsProof(req: { walletId: string; message: string }): Promise<PointsDeviceProof> {
    const result = await this.requestApproval({
      kind: "pointsProof",
      origin: WALLET_APPROVAL_ORIGIN,
      walletId: req.walletId,
      payload: new TextEncoder().encode(req.message),
      tags: [],
    });
    return result as PointsDeviceProof;
  }

  /**
   * Asks the user to sign a community scan attestation the Gleam site
   * handed over, then submits it to the points API. Resolves to the
   * server's verdict, which the window also shows; rejects with
   * `ApprovalDeclinedError` if the user doesn't approve.
   */
  async requestScanAttestation(req: {
    origin: string;
    walletId: string;
    address: string;
    attestation: ParsedAttestation;
  }): Promise<SiteAttestResponse> {
    // One at a time: a second link, or the same one sent twice, focuses
    // the window already open instead of stacking signing prompts.
    if (this.attesting) {
      await this.focusPendingAttestation();
      return attestFailure("busy", req.attestation.release);
    }
    this.attesting = true;
    try {
      if (await this.focusPendingAttestation()) return attestFailure("busy", req.attestation.release);
      const message = buildAttestMessage(req.attestation.release, await attestationId(req.attestation));
      const result = await this.requestApproval({
        kind: "scanAttestation",
        origin: req.origin,
        walletId: req.walletId,
        address: req.address,
        attestation: req.attestation,
        payload: new TextEncoder().encode(message),
        tags: [],
      });
      return result as SiteAttestResponse;
    } finally {
      this.attesting = false;
    }
  }

  /** Focuses a scan attestation's window if one is pending; says whether there was one. */
  private async focusPendingAttestation(): Promise<boolean> {
    const pending = (await this.loadPending()).find((entry) => entry.request.kind === "scanAttestation");
    if (!pending) return false;
    await this.presenter.focus(pending.request.requestId);
    return true;
  }

  private attestationSubmitter(): ScanAttestationSubmitter {
    if (!this.attestations) {
      throw new Error(dappError("Scan attestations aren't wired. ApprovalHandler was constructed without a submitter."));
    }
    return this.attestations;
  }

  private async finalizeApproval(entry: PendingApprovalRecord): Promise<unknown> {
    if (entry.request.kind === "connect") {
      return this.createGrant(entry);
    }
    if (entry.request.kind === "addToken") {
      return this.addToken(entry);
    }
    return this.performSigning(entry);
  }

  private async createGrant(entry: PendingApprovalRecord): Promise<{ granted: PermissionType[] }> {
    const preview = entry.request.preview as ConnectApprovalPreview;
    const name = preview.appInfo?.name ?? null;
    return this.mergeGrant(entry.request.origin, entry.walletId, preview.requestedPermissions, {
      icon: entry.siteIcon ?? null,
      name: name !== null && !UNSAFE_TEXT.test(name) ? name : null,
    });
  }

  /**
   * Grants `origin` from the popup's "Use Gleam here", where the user
   * picked the permissions themselves, so no approval window opens.
   */
  async grantSite(req: { origin: string; permissions: PermissionType[]; favIconUrl?: string | null }): Promise<Grant> {
    const permissions = Array.isArray(req.permissions) ? [...new Set(req.permissions.filter(isValidPermissionType))] : [];
    if (!permissions.includes("ACCESS_ADDRESS")) permissions.unshift("ACCESS_ADDRESS");
    await this.mergeGrant(req.origin, null, permissions, { icon: safeSiteIconUrl(req.favIconUrl), name: null });
    const grant = await this.findActiveGrant(req.origin);
    if (!grant) throw new Error(dappError(`Couldn't save the grant for "${req.origin}".`));
    return grant;
  }

  private async mergeGrant(
    origin: string,
    walletId: string | null,
    requested: readonly PermissionType[],
    site: { icon: string | null; name: string | null },
  ): Promise<{ granted: PermissionType[] }> {
    const grantWalletId = walletId ?? (await this.activeWalletId());
    if (!grantWalletId) {
      throw new Error(userErrorMessage("noWalletToConnect"));
    }
    if ((await this.keySession.getWalletMethod(grantWalletId)) === "watch") {
      throw new Error(WATCH_ONLY_CONNECT_REFUSAL);
    }
    return this.updateGrants((grants) => {
      const withoutExisting = grants.filter((grant) => grant.origin !== origin);
      // A connect from an already-connected origin only asks for what the
      // grant lacks, so approving it adds to the grant instead of narrowing it.
      const existing = activeGrant(grants, origin);
      const permissions = [...(existing?.permissions ?? [])];
      for (const permission of requested) {
        if (!permissions.includes(permission)) permissions.push(permission);
      }

      const grant: Grant = {
        origin,
        walletId: grantWalletId,
        permissions,
        createdAt: Date.now(),
        expiresAt: null,
        budget: null,
        icon: site.icon ?? existing?.icon ?? null,
        name: site.name ?? existing?.name ?? null,
      };

      return { next: [...withoutExisting, grant], result: { granted: grant.permissions } };
    });
  }

  /**
   * Adds to the address the request was made for, even if the user has
   * switched wallets since: that is the address the window showed.
   * Resolves to `undefined`, as Wander's `addToken` does.
   */
  private async addToken(entry: PendingApprovalRecord): Promise<undefined> {
    if (!this.tokens) {
      throw new Error(dappError("addToken is not wired to a token list. ApprovalHandler was constructed without one."));
    }
    const input = fromStored(entry.signingInput) as AddTokenRequestInput | null;
    if (!input || input.kind !== "addToken") {
      throw new Error(dappError(`Approval request "${entry.request.requestId}" has no token to add.`));
    }
    await this.tokens.addWatchedToken({ address: input.address, processId: input.processId });
    return undefined;
  }

  /**
   * Reads the already-unlocked signing key and performs the real
   * cryptographic operation the approved preview described — everything
   * `buildSigningPreview` computed (recipient/amount/payload hash/tags)
   * is display-only; the actual operation is re-derived here from
   * `signingInput`'s typed fields, never from the decoded preview.
   * Throws if the wallet isn't currently unlocked (`key-session.ts` has
   * no cached key for it). The approval window unlocks before it shows
   * the request, so this only fires if the wallet locks in between.
   */
  private async performSigning(entry: PendingApprovalRecord): Promise<unknown> {
    const input = this.signingInputOf(entry);

    const { walletId } = entry;
    if (!walletId) {
      throw new Error(dappError(`Approval request "${entry.request.requestId}" has no wallet to sign with.`));
    }
    // Encryption needs only the public key, which every wallet kind
    // stores, so it never touches the key cache.
    if (input.kind === "encrypt") {
      if (!input.encryptAlgorithm) {
        throw new Error(dappError("encrypt requires an algorithm."));
      }
      const owner = await this.storedOwner(walletId);
      return encrypt(owner, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
    }

    const signer = await this.keySession.getSigner(walletId);
    if (!signer) {
      throw new Error(userErrorMessage("walletLocked", { wallet: walletId }));
    }

    if (input.kind === "transferAoTokens" || input.kind === "transfer") {
      return this.performTransfer(walletId, input);
    }

    switch (input.kind) {
      case "sign":
      case "dispatch":
      case "signDataItem":
      case "batchSignDataItem": {
        // A cached key means a keyfile wallet even if its record can't be read.
        const method = (await this.keySession.getWalletMethod(walletId)) ?? "jwk";
        const payloads = await this.prepareDappPayloads(signer.owner, method, input);
        assertPreparedMatches(input, payloads, signer.address);
        const signatures: Uint8Array[] = [];
        for (const payload of payloads) signatures.push(await signPayloadWithSigner(payload, signer));
        return this.finishDappPayloads(signer.owner, input, payloads, signatures);
      }

      case "decrypt": {
        if (!input.encryptAlgorithm) {
          throw new Error(dappError("decrypt requires an algorithm."));
        }
        return decrypt(signer, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
      }

      case "signMessage": {
        return new Uint8Array(await vaultSignMessage(signer, toArrayBuffer(input.payload), input.hashAlgorithm));
      }

      // A keyfile proves ownership with signMessage in PointsHandler and never reaches here.
      case "pointsProof":
        throw new Error(dappError("Only a hardware wallet proves ownership through the approval window."));

      case "scanAttestation":
        return this.attestationSubmitter().attest({ walletId, attestation: parsedAttestationOf(input) });

      default: {
        const exhaustiveCheck: never = input.kind;
        throw new Error(dappError(`Unhandled signing kind "${String(exhaustiveCheck)}".`));
      }
    }
  }

  private requireGatewayUrl(input: SigningRequestInput): string {
    if (!input.gatewayUrl) {
      throw new Error(dappError(`"${input.kind}" requires a gateway URL to construct the transaction.`));
    }
    return input.gatewayUrl;
  }

  /**
   * Finalizes an approved `transferAoTokens` request by reusing the exact
   * same `TransferHandler.submitTransfer` path the popup's `SendView`
   * already goes through (`token`/`recipient`/`amount`/`fee`, plus
   * the `walletId` this Grant resolved) — no new signing path, no
   * duplicate AO-messaging client wiring. Returns `AoTokenTransferResult`
   * shape (`{ id }`), mirroring `submitTransfer`'s `{ txId }` under the
   * ArConnect-compatible `dispatch()`-style field name the dApp expects.
   */
  private async performTransfer(walletId: string, input: SigningRequestInput): Promise<{ id: string } | { txId: string }> {
    if (!this.transfers) {
      throw new Error(
        `${input.kind} is not wired to a transfer submitter — ApprovalHandler was constructed ` +
          "without an AoTransferSubmitter.",
      );
    }
    const { txId } = await this.transfers.submitTransfer(this.transferRequestOf(walletId, input));
    return input.kind === "transfer" ? { txId } : { id: txId };
  }

  /**
   * The wallet's stored public key (`owner`). It must hash to the
   * wallet's address, so a tampered or corrupted record can't redirect
   * what a dApp encrypts.
   */
  private async storedOwner(walletId: string): Promise<string> {
    const wallet = await this.keySession.getStoredWallet(walletId);
    if (!wallet || wallet.publicKey.length === 0) {
      throw new Error(userErrorMessage("noStoredPublicKey", { wallet: walletId }));
    }
    if ((await addressFromOwner(wallet.publicKey)) !== wallet.address) {
      throw new Error(userErrorMessage("storedKeyEncryptionMismatch"));
    }
    return wallet.publicKey;
  }

  /**
   * Rejects the approvals still waiting on a wallet that is being removed.
   * Grants are left alone: they belong to the site and follow whichever
   * wallet is active, so removing one of several wallets disconnects nobody.
   */
  async rejectWalletApprovals(walletId: string): Promise<void> {
    await this.rejectPendingWhere((entry) => entry.walletId === walletId, "The wallet was removed.");
  }

  /** Rejects the dApp signing requests made for another wallet than `walletId`, which just became active. */
  async rejectSwitchedApprovals(walletId: string): Promise<void> {
    await this.rejectPendingWhere((entry) => signsForActiveWallet(entry) && entry.walletId !== walletId, WALLET_SWITCHED);
  }

  /**
   * Revokes every Grant and rejects every pending approval, for when no
   * wallet is left (a reset, or removing the last one). Returns the revoked
   * origins, which should be told they're disconnected.
   */
  async revokeAllAccess(reason = "The wallet was reset."): Promise<string[]> {
    const origins = await this.updateGrants((grants) => ({ next: null, result: grants.map((grant) => grant.origin) }));
    await this.rejectPendingWhere(() => true, reason);
    return origins;
  }

  /**
   * Skips requests `resolveApproval` is already finishing: it re-reads the
   * record to attach its outcome, and signing fails on its own once the
   * wallet's key is gone.
   */
  private async rejectPendingWhere(
    matches: (entry: PendingApprovalRecord) => boolean,
    error: string,
  ): Promise<void> {
    const outcome: ApprovalOutcome = { approved: false, error };
    const rejected = new Set<string>();
    await this.updatePending((pending) => {
      for (const entry of pending) {
        if (!entry.outcome && !this.resolving.has(entry.request.requestId) && matches(entry)) {
          rejected.add(entry.request.requestId);
        }
      }
      if (rejected.size === 0) return null;
      return pending.map((entry) => (rejected.has(entry.request.requestId) ? { ...entry, outcome } : entry));
    });
    if (rejected.size === 0) return;

    await this.updatePending((current) => current.filter((entry) => !rejected.has(entry.request.requestId)));
    await Promise.all([...rejected].map((requestId) => this.presenter.dismiss(requestId)));
  }

  /**
   * Revokes a Grant — ends all access it covered immediately: the site's
   * requests still waiting for approval are rejected and their windows
   * closed. A pending connect stays, since approving it is a fresh grant.
   * One already being resolved is caught by `lapsedSince` once its work
   * is done (`withheldIfLapsed`).
   */
  async revokeGrant(req: { origin: string }): Promise<void> {
    await this.updateGrants((grants) => ({
      next: grants.filter((grant) => grant.origin !== req.origin),
      result: undefined,
    }));
    await this.rejectPendingWhere((entry) => needsGrant(entry) && entry.request.origin === req.origin, SITE_DISCONNECTED);
  }

  /** Read-only list of connected origins, for the `connected-apps` popup view. */
  async getConnectedApps(): Promise<Grant[]> {
    return this.loadGrants();
  }
}
