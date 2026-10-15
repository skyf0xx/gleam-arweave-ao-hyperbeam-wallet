import {
  addressFromOwner,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  batchSignDataItem,
  capabilitiesFor,
  decrypt,
  DEFAULT_BUNDLER_URL,
  dispatchTransaction,
  encrypt,
  finishDataItem,
  finishDataItems,
  finishDispatch,
  finishSignTransaction,
  isHardwareWalletMethod,
  prepareDataItem,
  prepareDataItems,
  prepareDispatch,
  prepareSignTransaction,
  privateHash as vaultPrivateHash,
  readDataItemFields,
  HARDWARE_MESSAGE_HASH,
  signDataItem,
  signMessage as vaultSignMessage,
  signTransaction,
  signature as vaultSignature,
  verifyDeviceSignature,
  PERMISSION_TYPES,
  WALLET_APPROVAL_ORIGIN,
  type AddTokenApprovalPreview,
  type CollectibleRef,
  type ApprovalKind,
  type ApprovalPreview,
  type ApprovalRequest,
  type ConnectAppInfo,
  type ConnectApprovalPreview,
  type DataItemInput,
  type DeviceSigningPayload,
  type DeviceSigningSummary,
  type EncryptAlgorithm,
  type Grant,
  type HardwareDevice,
  type HardwareWalletMethod,
  type PermissionType,
  type SignTransactionInput,
  type SigningApprovalPreview,
  type StoragePort,
  type UnsignedPayload,
  type WindowPort,
} from "@gleam/core";
import {
  APPROVAL_MAX_MS,
  APPROVAL_TIMEOUT_MS,
  decodeTaggedBinary,
  encodeTaggedBinary,
} from "@gleam/messaging/src/page-protocol.ts";
import { buildOwnershipTransaction, POINTS_PROOF_TAG } from "@gleam/core/src/points/index.ts";
import { collectibleTransferTags, readCollectibleTransfer } from "@gleam/core/src/ao/collectible-transfer.ts";
import { getSigner, getStoredWallet, getWalletMethod } from "./key-session";
import type { SubmitTransferRequest } from "./transfer";

/**
 * Background-side implementation of `ProtocolMap`'s `getApproval`/
 * `resolveApproval`, plus the internal (non-`ProtocolMap`) API the
 * `background.ts` dispatcher uses to actually create an `ApprovalRequest`,
 * open its window, and await the user's decision before letting a
 * page-originated provider call resume. `connect()` requests show the
 * origin and requested permission scopes and open in their own window; a
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
 *   MV3 service-worker idle-kill/restart while the approval window stays
 *   open, which is the restart this needs to survive.
 *
 * Waiting for resolution: the dispatcher's `requestApproval()` call
 * resolves only once `resolveApproval` is called for that `requestId`.
 * Rather than a service-worker-local `Map<requestId, deferred>` result
 * store (which cannot survive an SW restart while the approval window is
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
 * Closing the approval window with its own close button counts as a
 * rejection: `WindowPort.onApprovalWindowClosed` writes a rejected outcome
 * the same way `resolveApproval` does, so the dApp hears back at once
 * instead of after `APPROVAL_TIMEOUT_MS`.
 *
 * Hardware wallets: the service worker can't reach the camera or WebHID,
 * so every hardware signature is made in the approval window. Approving
 * a hardware wallet's request builds the unsigned payloads from the
 * wallet's stored public key and moves the record to "awaiting device"
 * (`PendingApprovalRecord.device`) instead of finishing it. The window
 * then sends `submitDeviceSignature`, which verifies each signature
 * against that key before anything is returned or posted. A signature
 * that fails verification leaves the request waiting so the user can
 * sign again. While waiting, the timeout follows `device.deadline`,
 * which `deviceActivity` pushes back up to `APPROVAL_MAX_MS` from the
 * request's creation.
 *
 * Deadlines are also enforced on read, since an evicted service worker
 * loses its timers: a record past its deadline (`device.deadline`, or
 * `APPROVAL_TIMEOUT_MS` after creation while in review) is hidden from
 * every read and pruned on the next write, unless it is being resolved.
 */
const GRANTS_KEY = "local:grants";
const PENDING_APPROVALS_KEY = "session:pendingApprovals";
const APPROVAL_WINDOW_PATH = "/approval.html";

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
    candidate.budget === null
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
  /** `sign`/`dispatch`'s transaction-shaped fields beyond `payload`/`tags` — `target`/`quantity`/`reward`/`last_tx`. */
  target?: string;
  quantity?: string;
  reward?: string;
  last_tx?: string;
  /** `signDataItem`/`batchSignDataItem`'s items. `payload` and `tags` above are the first item's, for the preview. */
  dataItems?: DataItemInput[];
  /** `encrypt`/`decrypt`'s WebCrypto algorithm parameter. */
  encryptAlgorithm?: EncryptAlgorithm;
  /** `signMessage`/`signature`/`privateHash`'s hash digest selection. */
  hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512";
  /** `signature`'s RSA-PSS salt length. */
  saltLength?: number;
}

/**
 * The `AoTokenTransferRequest` shape a `transferAoTokens` signing approval
 * carries through to `performSigning`, so it can call
 * `TransferHandler.submitTransfer` with exactly the fields that handler
 * needs (`token`/`recipient`/`amount`/`fee: null`/`walletId`) once the user
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
 * `StoragePort`/`WindowPort` ports-style injection this class already
 * uses). Optional constructor param: every existing call site/test that
 * never exercises a transfer is unaffected.
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
 * `result` and `signingInput` hold bytes (payloads, AES IVs, signatures),
 * and `chrome.storage` serializes a `Uint8Array` as a plain object. Both
 * are stored through the tagged-binary codec and decoded when read.
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
  /** Set by `resolveApproval` immediately before the record is removed. */
  outcome?: ApprovalOutcome;
  /** Set once a hardware wallet's request is approved and waits for the device. */
  device?: PendingDeviceSigning;
}

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
  "signMessage",
]);

const TIMED_OUT = "Approval request timed out — the approval window was not resolved in time.";

/** How soon a timeout looks again at a request that was being resolved when it fired. */
const RESOLVING_RECHECK_MS = 5_000;

const textDecoder = new TextDecoder();
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

/** How much of a message the device step shows; the dApp's preview already showed it in full. */
const MESSAGE_TEXT_LIMIT = 500;

// Control characters other than tab/newline, and bidi overrides, can make
// shown text differ from the signed bytes, so such a message shows its size.
const UNSAFE_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

function messageText(data: Uint8Array): string | null {
  let text: string;
  try {
    text = strictTextDecoder.decode(data);
  } catch {
    return null;
  }
  if (text.length === 0 || UNSAFE_TEXT.test(text.replace(/[\t\n]/g, ""))) return null;
  return text.length > MESSAGE_TEXT_LIMIT ? `${text.slice(0, MESSAGE_TEXT_LIMIT)}…` : text;
}

function decodeTransactionTag(tag: { name: string; value: string }): { name: string; value: string } {
  return { name: textDecoder.decode(base64UrlToBytes(tag.name)), value: textDecoder.decode(base64UrlToBytes(tag.value)) };
}

function tagValue(tags: Array<{ name: string; value: string }>, name: string): string | undefined {
  return tags.find((tag) => tag.name === name)?.value;
}

function summarize(payload: UnsignedPayload): DeviceSigningSummary {
  if (payload.kind === "message") {
    return { kind: "message", text: messageText(payload.data), size: payload.data.byteLength };
  }
  if (payload.kind === "transaction") {
    const { target, quantity, reward, data_size, tags } = payload.transaction;
    const collectible = readCollectibleTransfer({ target, quantity, data_size, tags: tags.map(decodeTransactionTag) });
    if (collectible) {
      return { kind: "collectibleTransfer", asset: collectible.assetId, recipient: collectible.recipient, fee: reward };
    }
    return { kind: "transaction", recipient: target || null, quantity, fee: reward, dataSize: data_size };
  }
  const { target, tags, data } = readDataItemFields(payload.raw);
  const recipient = tagValue(tags, "Recipient");
  const quantity = tagValue(tags, "Quantity");
  if (tagValue(tags, "Data-Protocol") === "ao" && tagValue(tags, "Action") === "Transfer" && target && recipient && quantity) {
    return { kind: "aoTransfer", process: target, recipient, quantity };
  }
  return { kind: "dataItem", target: target || null, dataSize: data.byteLength };
}

function sameTags(actual: Array<{ name: string; value: string }>, expected: Array<{ name: string; value: string }>): boolean {
  return (
    actual.length === expected.length &&
    actual.every((tag, index) => tag.name === expected[index]!.name && tag.value === expected[index]!.value)
  );
}

function normalizedQuantity(quantity: string | undefined): string {
  const trimmed = quantity?.trim() ?? "";
  return trimmed === "" ? "0" : trimmed;
}

function mismatch(field: string): never {
  throw new Error(`The prepared ${field} doesn't match the request, so nothing was sent to the device.`);
}

interface ExpectedTransaction {
  target: string;
  quantity: string;
  tags: Array<{ name: string; value: string }>;
  data: Uint8Array;
  reward?: string;
}

function checkTransaction(payload: UnsignedPayload | undefined, expected: ExpectedTransaction): void {
  const transaction = transactionOf(payload).transaction;
  if (transaction.target !== expected.target) mismatch("recipient");
  if (normalizedQuantity(transaction.quantity) !== normalizedQuantity(expected.quantity)) mismatch("amount");
  if (!sameTags(transaction.tags.map(decodeTransactionTag), expected.tags)) mismatch("tags");
  if (transaction.data !== bytesToBase64Url(expected.data)) mismatch("data");
  if (expected.reward !== undefined && transaction.reward !== expected.reward) mismatch("fee");
}

interface ExpectedDataItem {
  target: string;
  tags: Array<{ name: string; value: string }>;
  data: Uint8Array;
  anchor?: string;
}

function checkDataItem(payload: UnsignedPayload | undefined, expected: ExpectedDataItem): void {
  const fields = readDataItemFields(dataItemOf(payload));
  if (fields.target !== expected.target) mismatch("target");
  if (!sameTags(fields.tags, expected.tags)) mismatch("tags");
  if (bytesToBase64Url(fields.data) !== bytesToBase64Url(expected.data)) mismatch("data");
  if (expected.anchor !== undefined && fields.anchor !== expected.anchor) mismatch("anchor");
}

function plainTags(tags: SigningRequestInput["tags"]): Array<{ name: string; value: string }> {
  return (tags ?? []).map(({ name, value }) => ({ name, value }));
}

/**
 * Re-reads what was prepared against the request the user approved. The
 * transaction builder fetches the anchor and, when the request has none,
 * the reward after approval; everything else must come out exactly as
 * requested.
 */
function assertPreparedMatches(input: SigningRequestInput, payloads: UnsignedPayload[]): void {
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
    case "transfer": {
      const [payload] = payloads;
      if (input.collectible) {
        checkTransaction(payload, {
          target: input.collectible.id,
          quantity: "0",
          tags: collectibleTransferTags(input.recipient ?? ""),
          data: new Uint8Array(),
        });
        return;
      }
      if (input.token == null) {
        checkTransaction(payload, {
          target: input.recipient ?? "",
          quantity: input.amount ?? "",
          tags: [],
          data: new Uint8Array(),
        });
        return;
      }
      const summary = summarize(payload!);
      if (summary.kind !== "aoTransfer") mismatch("AO transfer");
      if (summary.process !== input.token) mismatch("token");
      if (summary.recipient !== input.recipient) mismatch("recipient");
      if (summary.quantity !== input.amount) mismatch("amount");
      return;
    }
    case "signMessage": {
      const [payload] = payloads;
      if (payloads.length !== 1 || payload?.kind !== "message") mismatch("message");
      if (bytesToBase64Url(payload.data) !== bytesToBase64Url(input.payload)) mismatch("message");
      return;
    }
    case "pointsProof":
      checkTransaction(payloads[0], {
        target: "",
        quantity: "0",
        tags: [{ name: POINTS_PROOF_TAG, value: textDecoder.decode(input.payload) }],
        data: new Uint8Array(),
        reward: "0",
      });
      return;
    default:
      return;
  }
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

function transactionOf(payload: UnsignedPayload | undefined): UnsignedPayload & { kind: "transaction" } {
  if (payload?.kind !== "transaction") throw new Error("Expected an unsigned transaction to finish.");
  return payload;
}

function dataItemOf(payload: UnsignedPayload | undefined): Uint8Array {
  if (payload?.kind !== "dataItem") throw new Error("Expected an unsigned data item to finish.");
  return payload.raw;
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

function decodeDataPreview(payload: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    return text;
  } catch {
    return null;
  }
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

function buildConnectPreview(
  requestedPermissions: PermissionType[],
  appInfo: ConnectAppInfo | null,
): ConnectApprovalPreview {
  return { kind: "connect", requestedPermissions, appInfo };
}

/**
 * `signDataItem`/`batchSignDataItem` carry every item in `input.dataItems`
 * (`input.payload`/`input.tags` are only item 1's, kept for every other
 * kind's single-payload preview) — decodes each one so the approval window
 * can list them all rather than showing item 1 while the rest sign unseen.
 */
async function buildDataItemPreviews(
  dataItems: NonNullable<SigningRequestInput["dataItems"]>,
): Promise<SigningApprovalPreview["items"]> {
  return Promise.all(
    dataItems.map(async (item) => {
      const bytes = base64ToBytes(item.data);
      return {
        decodedData: decodeDataPreview(bytes),
        tags: item.tags ?? [],
        target: item.target ?? null,
        payloadHash: await sha256Hex(bytes),
      };
    }),
  );
}

async function buildSigningPreview(input: SigningRequestInput): Promise<SigningApprovalPreview> {
  const payloadHash = await sha256Hex(input.payload);
  const isBatch = input.kind === "batchSignDataItem";
  return {
    kind: input.kind,
    recipient: input.recipient ?? null,
    amount: input.amount ?? null,
    fee: input.fee ?? null,
    token: input.token ?? null,
    tokenDenomination: input.tokenDenomination ?? null,
    tokenTicker: input.tokenTicker ?? null,
    ...(input.collectible ? { collectible: input.collectible } : {}),
    decodedData: decodeDataPreview(input.payload),
    tags: input.tags ?? [],
    payloadHash,
    items: isBatch && input.dataItems ? await buildDataItemPreviews(input.dataItems) : null,
  };
}

export class ApprovalHandler {
  /**
   * Requests `resolveApproval` is finishing. Closing the window while an
   * approved request signs or posts must not also report it as rejected.
   */
  private readonly resolving = new Set<string>();

  /**
   * Tail of the queue every `session:pendingApprovals` read-modify-write
   * runs on. Each one awaits a read before its write, so two running at
   * once would each write back an array missing the other's change.
   */
  private pendingQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StoragePort,
    private readonly windows: WindowPort,
    private readonly transfers?: TransferSubmitter,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
    private readonly activeWalletId: () => Promise<string | null> = async () => null,
    private readonly tokens?: TokenWatchList,
  ) {
    windows.onApprovalWindowClosed((requestId) => {
      void this.rejectClosedWindow(requestId);
    });
  }

  private async loadGrants(): Promise<Grant[]> {
    const raw = await this.storage.get<unknown>(GRANTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidGrant);
  }

  private async saveGrants(grants: Grant[]): Promise<void> {
    await this.storage.set(GRANTS_KEY, grants);
  }

  /** Past its deadline with nothing settling it. A request being resolved runs to completion. */
  private pastDeadline(entry: PendingApprovalRecord): boolean {
    if (entry.outcome) return false;
    const deadline = entry.device?.deadline ?? entry.request.createdAt + APPROVAL_TIMEOUT_MS;
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
    const raw = await this.storage.get<unknown>(PENDING_APPROVALS_KEY);
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

  /**
   * The only way to write pending approvals. `update` sees the current
   * records, stale ones included so a timeout can attach its outcome, and
   * returns the new ones, or `null` to leave storage untouched. Stale
   * records are pruned from what is written.
   */
  private updatePending(
    update: (pending: PendingApprovalRecord[]) => PendingApprovalRecord[] | null,
  ): Promise<void> {
    const run = this.pendingQueue.then(async () => {
      const next = update(await this.loadAllPending());
      if (next) await this.storage.set(PENDING_APPROVALS_KEY, next.filter((entry) => !this.isStale(entry)));
    });
    this.pendingQueue = run.catch(() => {});
    return run;
  }

  /**
   * Origin -> wallet permission lookup. A connected origin's Grant must
   * still be present and unexpired for a `PROVIDER_METHODS` call to
   * proceed without a fresh approval prompt — revoking a Grant (or
   * letting it expire) ends all access it covered.
   */
  async findActiveGrant(origin: string): Promise<Grant | null> {
    const grants = await this.loadGrants();
    const grant = grants.find((candidate) => candidate.origin === origin);
    if (!grant) return null;
    if (grant.expiresAt !== null && grant.expiresAt <= Date.now()) return null;
    return grant;
  }

  /**
   * Creates a pending `ApprovalRequest`, opens its own approval window
   * (never inline in the popup), and resolves once `resolveApproval` has
   * been called for it. Rejects on
   * explicit rejection or on timeout (a hung/abandoned approval window
   * must not hang the calling dApp forever).
   */
  async requestApproval(input: CreateApprovalInput): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const preview: ApprovalPreview =
      input.kind === "connect"
        ? buildConnectPreview(input.requestedPermissions, input.appInfo ?? null)
        : input.kind === "addToken"
          ? buildAddTokenPreview(input)
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
      signingInput: input.kind === "connect" ? null : encodeTaggedBinary(input),
    };
    await this.updatePending((pending) => [...pending, record]);

    await this.windows.createApprovalWindow(
      `${APPROVAL_WINDOW_PATH}?requestId=${encodeURIComponent(requestId)}`,
    );

    return this.awaitResolution(requestId);
  }

  /**
   * Resolves once `resolveApproval` has written an `outcome` onto this
   * request's pending record (observed via `StoragePort.watch`, which
   * fires with the full new array on every write — including the
   * one-tick write `resolveApproval` makes just before removing the
   * record), or rejects on timeout.
   */
  private async awaitResolution(requestId: string): Promise<unknown> {
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
        void this.windows.closeApprovalWindow(requestId);
        reject(new Error(TIMED_OUT));
      };
      expireAt(Date.now() + APPROVAL_TIMEOUT_MS);

      const unwatch = this.storage.watch<PendingApprovalRecord[]>(PENDING_APPROVALS_KEY, (value) => {
        const entry = (value ?? []).find((candidate) => candidate.request.requestId === requestId);
        if (!entry?.outcome) return;

        clearTimeout(timeout);
        unwatch();
        const { outcome } = entry;
        if (!outcome.approved) {
          reject(new Error(outcome.error ?? "The request was rejected."));
        } else if (outcome.error) {
          reject(new Error(outcome.error));
        } else {
          resolve(decodeTaggedBinary(outcome.result));
        }
      });
    });
  }

  /**
   * Also drops a record left behind by a service worker that restarted
   * while its window was open, even though nothing is awaiting it.
   */
  private async rejectClosedWindow(requestId: string): Promise<void> {
    const outcome: ApprovalOutcome = { approved: false, error: "The approval window was closed." };
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
      throw new Error(`No pending approval request with id "${requestId}".`);
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
      throw new Error(`No pending approval request with id "${requestId}".`);
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
    await this.windows.closeApprovalWindow(requestId);
    throw new Error(TIMED_OUT);
  }

  /** `ProtocolMap.getApproval` — read-only, called by the approval window on mount. */
  async getApproval(req: { requestId: string }): Promise<ApprovalRequest> {
    return this.requestView(await this.findPending(req.requestId));
  }

  /** The request as the window sees it: with the device's payloads once it waits on one. */
  private async requestView(entry: PendingApprovalRecord): Promise<ApprovalRequest> {
    if (!entry.device || !entry.walletId) return entry.request;
    const wallet = await this.hardwareWallet(entry.walletId);
    const payloads = decodeTaggedBinary(entry.device.payloads) as UnsignedPayload[];
    return {
      ...entry.request,
      device: {
        ...wallet,
        payloads: payloads.map(toWirePayload),
        summaries: payloads.map(summarize),
        deadline: entry.device.deadline,
      },
    };
  }

  /**
   * `ProtocolMap.resolveApproval` — called only from the approval window
   * (`APPROVAL_METHODS`, enforced by the dispatcher choke point, not by
   * this handler). On a `connect` approval, creates and persists a real
   * `Grant`. On a signing approval, performs the actual signing operation
   * using the signing key `key-session.ts` cached at unlock (no password
   * staging step needed any more — see this class's doc comment on why
   * `unlockApprovalWallet` existed and `wallet-lifecycle.ts`'s doc comment
   * for the superseding session-cache decision) and returns the result to
   * the original caller, then closes the approval window.
   *
   * If an approved request fails (locked wallet, network error), the dApp
   * is rejected with that error and this call throws it too. The window
   * stays open so the user sees why instead of a success message.
   */
  async resolveApproval(req: { requestId: string; approved: boolean }): Promise<ApprovalRequest | void> {
    const entry = await this.findPending(req.requestId);
    if (this.resolving.has(req.requestId)) {
      throw new Error(`Approval request "${req.requestId}" is already being resolved.`);
    }
    if (req.approved && entry.device) {
      throw new Error("This request is already approved. Sign it on your device.");
    }
    this.resolving.add(req.requestId);
    try {
      let outcome: ApprovalOutcome;
      if (!req.approved) {
        outcome = { approved: false };
      } else {
        try {
          if (await this.signsOnDevice(entry)) return await this.startDeviceSigning(entry);
          outcome = { approved: true, result: encodeTaggedBinary(await this.finalizeApproval(entry)) };
        } catch (error) {
          outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
        }
      }
      await this.complete(req.requestId, outcome);
    } finally {
      this.resolving.delete(req.requestId);
    }
  }

  /**
   * Hands the outcome to whoever awaits the request, drops it, and closes
   * its window. A failed outcome throws instead, leaving the window open
   * to show why.
   */
  private async complete(requestId: string, outcome: ApprovalOutcome): Promise<void> {
    // Written in two steps (outcome attached, then removed) so a watcher
    // observing this key sees the outcome at least once before the record
    // disappears — see this class's doc comment.
    await this.updatePending((current) =>
      current.map((candidate) => (candidate.request.requestId === requestId ? { ...candidate, outcome } : candidate)),
    );
    await this.dropPending(requestId);
    if (outcome.error !== undefined) throw new Error(outcome.error);
    await this.windows.closeApprovalWindow(requestId);
  }

  private async signsOnDevice(entry: PendingApprovalRecord): Promise<boolean> {
    if (!entry.walletId || !DEVICE_SIGNED_KINDS.has(entry.request.kind)) return false;
    const method = await getWalletMethod(entry.walletId);
    return method !== null && isHardwareWalletMethod(method);
  }

  /** The earliest of another idle window from now and the request's hard cap. */
  private deviceDeadline(createdAt: number): number {
    return Math.min(Date.now() + APPROVAL_TIMEOUT_MS, createdAt + APPROVAL_MAX_MS);
  }

  private async startDeviceSigning(entry: PendingApprovalRecord): Promise<ApprovalRequest> {
    const input = this.signingInputOf(entry);
    const walletId = entry.walletId!;
    const wallet = await this.hardwareWallet(walletId);
    const payloads = await this.prepareDevicePayloads(walletId, wallet, input);
    assertPreparedMatches(input, payloads);
    const device: PendingDeviceSigning = {
      payloads: encodeTaggedBinary(payloads),
      deadline: this.deviceDeadline(entry.request.createdAt),
    };
    const requestId = entry.request.requestId;
    let stillPending = false;
    await this.updatePending((current) => {
      stillPending = current.some((candidate) => candidate.request.requestId === requestId && !candidate.outcome);
      if (!stillPending) return null;
      return current.map((candidate) => (candidate.request.requestId === requestId ? { ...candidate, device } : candidate));
    });
    if (!stillPending) {
      throw new Error("This request ended while it was being prepared for your device. Start again from the app.");
    }
    return this.requestView({ ...entry, device });
  }

  /** `ProtocolMap.deviceActivity`. */
  async deviceActivity(req: { requestId: string }): Promise<{ deadline: number }> {
    const entry = await this.findLive(req.requestId, false);
    if (!entry.device) {
      throw new Error(`Approval request "${req.requestId}" isn't waiting for a device.`);
    }
    const deadline = this.deviceDeadline(entry.request.createdAt);
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
  async submitDeviceSignature(req: { requestId: string; signatures: string[] }): Promise<void> {
    if (this.resolving.has(req.requestId)) {
      throw new Error(`Approval request "${req.requestId}" is already being resolved.`);
    }
    this.resolving.add(req.requestId);
    try {
      const entry = await this.findLive(req.requestId, true);
      if (!entry.device || !entry.walletId) {
        throw new Error(`Approval request "${req.requestId}" isn't waiting for a device signature.`);
      }
      const walletId = entry.walletId;
      const payloads = decodeTaggedBinary(entry.device.payloads) as UnsignedPayload[];
      const wallet = await this.hardwareWallet(walletId);
      const signatures = await this.verifiedSignatures(payloads, req.signatures, wallet.publicKey);

      let outcome: ApprovalOutcome;
      try {
        const result = await this.finishDeviceSigning(walletId, wallet, this.signingInputOf(entry), payloads, signatures);
        outcome = { approved: true, result: encodeTaggedBinary(result) };
      } catch (error) {
        outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
      }
      await this.complete(req.requestId, outcome);
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
      throw new Error(`Expected ${payloads.length} signature(s) from the device, got ${encoded?.length ?? 0}.`);
    }
    const signatures = encoded.map((value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error("The device returned a signature that isn't base64url.");
      }
      return base64UrlToBytes(value);
    });
    for (const [index, payload] of payloads.entries()) {
      if (!(await verifyDeviceSignature(payload, signatures[index]!, publicKey))) {
        throw new Error(
          "The signature doesn't match this wallet. Check that the right device and account signed, then try again.",
        );
      }
    }
    return signatures;
  }

  private signingInputOf(entry: PendingApprovalRecord): SigningRequestInput {
    const input = decodeTaggedBinary(entry.signingInput) as SigningRequestInput | null;
    if (!input) {
      throw new Error(`Approval request "${entry.request.requestId}" has no signing input.`);
    }
    return input;
  }

  /**
   * The hardware wallet's public fields. Its stored key must hash to its
   * address, so a tampered record can't make the device sign as, or
   * verify against, some other owner.
   */
  private async hardwareWallet(walletId: string): Promise<HardwareWalletInfo> {
    const wallet = await getStoredWallet(walletId);
    if (!wallet || !isHardwareWalletMethod(wallet.method) || wallet.publicKey.length === 0) {
      throw new Error(`Wallet "${walletId}" isn't a hardware wallet with a stored public key.`);
    }
    if ((await addressFromOwner(wallet.publicKey)) !== wallet.address) {
      throw new Error("This wallet's stored public key doesn't match its address. Signing was refused.");
    }
    return { method: wallet.method, device: wallet.device ?? null, address: wallet.address, publicKey: wallet.publicKey };
  }

  private async prepareDevicePayloads(
    walletId: string,
    wallet: HardwareWalletInfo,
    input: SigningRequestInput,
  ): Promise<UnsignedPayload[]> {
    const owner = wallet.publicKey;
    switch (input.kind) {
      case "sign":
        return [
          {
            kind: "transaction",
            transaction: await prepareSignTransaction(this.requireGatewayUrl(input), owner, transactionInputOf(input)),
          },
        ];
      case "dispatch": {
        const { dispatchViaBundler: viaBundler } = capabilitiesFor(wallet.method);
        return [await prepareDispatch(this.requireGatewayUrl(input), owner, transactionInputOf(input), { viaBundler })];
      }
      case "signDataItem": {
        const [dataItem] = input.dataItems ?? [];
        if (!dataItem) throw new Error("signDataItem requires a data item.");
        return [{ kind: "dataItem", raw: prepareDataItem(owner, dataItem) }];
      }
      case "batchSignDataItem": {
        const items = input.dataItems ?? [];
        if (items.length === 0) throw new Error("batchSignDataItem requires at least one data item.");
        return prepareDataItems(owner, items).map((raw) => ({ kind: "dataItem", raw }));
      }
      case "transferAoTokens":
      case "transfer":
        return [await this.deviceTransfers().prepareDeviceTransfer(this.transferRequestOf(walletId, input), owner)];
      case "pointsProof":
        return [{ kind: "transaction", transaction: await buildOwnershipTransaction(owner, textDecoder.decode(input.payload)) }];
      case "signMessage": {
        const hashAlgorithm = input.hashAlgorithm ?? HARDWARE_MESSAGE_HASH;
        if (hashAlgorithm !== HARDWARE_MESSAGE_HASH) {
          throw new Error(`A hardware wallet signs messages with ${HARDWARE_MESSAGE_HASH} only, not ${hashAlgorithm}.`);
        }
        return [{ kind: "message", data: new Uint8Array(input.payload) }];
      }
      default:
        throw new Error(`A hardware wallet can't sign "${input.kind}" requests.`);
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
        return finishSignTransaction(transactionOf(payload).transaction, signature!, owner);
      case "dispatch":
        return finishDispatch(this.requireGatewayUrl(input), this.bundlerUrl, payload!, signature!, owner);
      case "signDataItem":
        return toArrayBuffer(await finishDataItem(dataItemOf(payload), signature!, owner));
      case "batchSignDataItem":
        return (await finishDataItems(payloads.map(dataItemOf), signatures, owner)).map(toArrayBuffer);
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
      case "signMessage":
        return new Uint8Array(signature!);
      default:
        throw new Error(`A hardware wallet can't sign "${input.kind}" requests.`);
    }
  }

  private deviceTransfers(): DeviceTransferSubmitter {
    const transfers = this.transfers;
    if (!transfers?.prepareDeviceTransfer || !transfers.finishDeviceTransfer) {
      throw new Error("Hardware wallet transfers aren't wired. ApprovalHandler was constructed without them.");
    }
    return transfers as DeviceTransferSubmitter;
  }

  private transferRequestOf(walletId: string, input: SigningRequestInput): SubmitTransferRequest {
    if (input.recipient == null || input.amount == null) {
      throw new Error(`A ${input.kind} approval is missing its recipient or amount.`);
    }
    if (input.kind === "transferAoTokens" && input.token == null) {
      throw new Error("A transferAoTokens approval is missing its token.");
    }
    return {
      token: input.token ?? null,
      recipient: input.recipient,
      amount: input.amount,
      fee: input.kind === "transfer" ? (input.fee ?? null) : null,
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
    return this.mergeGrant(entry.request.origin, entry.walletId, preview.requestedPermissions);
  }

  /**
   * Grants `origin` from the popup's "Use Gleam here", where the user
   * picked the permissions themselves, so no approval window opens.
   */
  async grantSite(req: { origin: string; permissions: PermissionType[] }): Promise<Grant> {
    const permissions = Array.isArray(req.permissions) ? [...new Set(req.permissions.filter(isValidPermissionType))] : [];
    if (!permissions.includes("ACCESS_ADDRESS")) permissions.unshift("ACCESS_ADDRESS");
    await this.mergeGrant(req.origin, null, permissions);
    const grant = await this.findActiveGrant(req.origin);
    if (!grant) throw new Error(`Couldn't save the grant for "${req.origin}".`);
    return grant;
  }

  private async mergeGrant(
    origin: string,
    walletId: string | null,
    requested: readonly PermissionType[],
  ): Promise<{ granted: PermissionType[] }> {
    const grantWalletId = walletId ?? (await this.activeWalletId());
    if (!grantWalletId) {
      throw new Error("There is no wallet to connect. Create or import one first.");
    }
    const grants = await this.loadGrants();
    const withoutExisting = grants.filter((grant) => grant.origin !== origin);
    // A connect from an already-connected origin only asks for what the
    // grant lacks, so approving it adds to the grant instead of narrowing it.
    const existing = await this.findActiveGrant(origin);
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
    };

    await this.saveGrants([...withoutExisting, grant]);
    return { granted: grant.permissions };
  }

  /**
   * Adds to the address the request was made for, even if the user has
   * switched wallets since: that is the address the window showed.
   * Resolves to `undefined`, as Wander's `addToken` does.
   */
  private async addToken(entry: PendingApprovalRecord): Promise<undefined> {
    if (!this.tokens) {
      throw new Error("addToken is not wired to a token list. ApprovalHandler was constructed without one.");
    }
    const input = decodeTaggedBinary(entry.signingInput) as AddTokenRequestInput | null;
    if (!input || input.kind !== "addToken") {
      throw new Error(`Approval request "${entry.request.requestId}" has no token to add.`);
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
      throw new Error(`Approval request "${entry.request.requestId}" has no wallet to sign with.`);
    }
    // Encryption needs only the public key, which every wallet kind
    // stores, so it never touches the key cache.
    if (input.kind === "encrypt") {
      if (!input.encryptAlgorithm) {
        throw new Error("encrypt requires an algorithm.");
      }
      const owner = await this.storedOwner(walletId);
      return encrypt(owner, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
    }

    const signer = await getSigner(walletId);
    if (!signer) {
      throw new Error(`Wallet "${walletId}" is locked. Unlock it to continue.`);
    }

    if (input.kind === "transferAoTokens" || input.kind === "transfer") {
      return this.performTransfer(walletId, input);
    }

    const transaction = transactionInputOf(input);

    switch (input.kind) {
      case "sign": {
        return signTransaction(this.requireGatewayUrl(input), signer, transaction);
      }

      case "dispatch": {
        // A cached key means a keyfile wallet even if its record can't be read.
        const { dispatchViaBundler: viaBundler } = capabilitiesFor((await getWalletMethod(walletId)) ?? "jwk");
        return dispatchTransaction(this.requireGatewayUrl(input), this.bundlerUrl, signer, transaction, { viaBundler });
      }

      case "signDataItem": {
        const [dataItem] = input.dataItems ?? [];
        if (!dataItem) throw new Error("signDataItem requires a data item.");
        // Wander resolves to the raw signed item as an ArrayBuffer, which
        // aoconnect's createDataItemSigner parses directly.
        return toArrayBuffer(await signDataItem(signer, dataItem));
      }

      case "batchSignDataItem": {
        const signed = await batchSignDataItem(signer, input.dataItems ?? []);
        return signed.map(toArrayBuffer);
      }

      case "decrypt": {
        if (!input.encryptAlgorithm) {
          throw new Error("decrypt requires an algorithm.");
        }
        return decrypt(signer, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
      }

      case "signature": {
        return new Uint8Array(await vaultSignature(signer, toArrayBuffer(input.payload), { saltLength: input.saltLength }));
      }

      case "signMessage": {
        return new Uint8Array(await vaultSignMessage(signer, toArrayBuffer(input.payload), input.hashAlgorithm));
      }

      case "privateHash": {
        return new Uint8Array(await vaultPrivateHash(signer, toArrayBuffer(input.payload), input.hashAlgorithm));
      }

      // A keyfile proves ownership with signMessage in PointsHandler and never reaches here.
      case "pointsProof":
        throw new Error("Only a hardware wallet proves ownership through the approval window.");

      default: {
        const exhaustiveCheck: never = input.kind;
        throw new Error(`Unhandled signing kind "${String(exhaustiveCheck)}".`);
      }
    }
  }

  private requireGatewayUrl(input: SigningRequestInput): string {
    if (!input.gatewayUrl) {
      throw new Error(`"${input.kind}" requires a gateway URL to construct the transaction.`);
    }
    return input.gatewayUrl;
  }

  /**
   * Finalizes an approved `transferAoTokens` request by reusing the exact
   * same `TransferHandler.submitTransfer` path the popup's `SendView`
   * already goes through (`token`/`recipient`/`amount`/`fee: null`, plus
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
    const wallet = await getStoredWallet(walletId);
    if (!wallet || wallet.publicKey.length === 0) {
      throw new Error(`No public key stored for wallet "${walletId}".`);
    }
    if ((await addressFromOwner(wallet.publicKey)) !== wallet.address) {
      throw new Error("This wallet's stored public key doesn't match its address. Encryption was refused.");
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

  /**
   * Revokes every Grant and rejects every pending approval, for when no
   * wallet is left (a reset, or removing the last one). Returns the revoked
   * origins, which should be told they're disconnected.
   */
  async revokeAllAccess(reason = "The wallet was reset."): Promise<string[]> {
    const grants = await this.loadGrants();
    await this.storage.remove(GRANTS_KEY);
    await this.rejectPendingWhere(() => true, reason);
    return grants.map((grant) => grant.origin);
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
    await Promise.all([...rejected].map((requestId) => this.windows.closeApprovalWindow(requestId)));
  }

  /** Revokes a Grant — ends all access it covered immediately. */
  async revokeGrant(req: { origin: string }): Promise<void> {
    const grants = await this.loadGrants();
    await this.saveGrants(grants.filter((grant) => grant.origin !== req.origin));
  }

  /** Read-only list of connected origins, for the `connected-apps` popup view. */
  async getConnectedApps(): Promise<Grant[]> {
    return this.loadGrants();
  }
}
