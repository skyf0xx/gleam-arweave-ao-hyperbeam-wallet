import {
  base64ToBytes,
  bytesToBase64,
  batchSignDataItem,
  decrypt,
  DEFAULT_BUNDLER_URL,
  dispatchTransaction,
  encrypt,
  privateHash as vaultPrivateHash,
  signDataItem,
  signMessage as vaultSignMessage,
  signTransaction,
  signature as vaultSignature,
  PERMISSION_TYPES,
  type ApprovalKind,
  type ApprovalPreview,
  type ApprovalRequest,
  type ConnectApprovalPreview,
  type DataItemInput,
  type EncryptAlgorithm,
  type Grant,
  type PermissionType,
  type SignTransactionInput,
  type SigningApprovalPreview,
  type StoragePort,
  type WindowPort,
} from "@gleam/core";
import { APPROVAL_TIMEOUT_MS, decodeTaggedBinary, encodeTaggedBinary } from "@gleam/messaging/src/page-protocol.ts";
import { getCachedKey } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s `getApproval`/
 * `resolveApproval`, plus the internal (non-`ProtocolMap`) API the
 * `background.ts` dispatcher uses to actually create an `ApprovalRequest`,
 * open its window, and await the user's decision before letting a
 * page-originated provider call resume — the "connect() requests show the
 * origin and requested permission scopes... approval opens in its own
 * window" and "signing approval shows recipient, amount, fee, a
 * decoded-data preview, tags, and a SHA-256 hash" rules this task's
 * packet names as the highest-stakes in the project.
 *
 * Storage schema this handler owns:
 * - `local:grants` — `Grant[]`, one per approved `connect()` origin. This
 *   is the exact key/shape `ReadsHandler.getConnectedApps()` (currently a
 *   hard `[]` stub, `wallet-core`'s declared debt) should be pointed at:
 *   `getConnectedApps` should become `const raw = await storage.get<
 *   unknown>("local:grants"); return Array.isArray(raw) ? raw.filter(
 *   isValidGrant) : [];` — a straight read, no join needed, since a Grant
 *   already carries every field `connected-apps.html` renders (origin,
 *   permissions, expiresAt, createdAt). Revoking removes the origin's
 *   entry from this same array; `getConnectedApps` needs no separate
 *   change to see a revoke take effect.
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
 * still open — exactly the MV3 failure mode ARCHITECTURE.md §5.1 warns
 * about), `resolveApproval` writes its outcome (`approved`/`result`/
 * `error`) directly onto the pending record in `session:pendingApprovals`
 * *before* removing it, and `requestApproval`'s `StoragePort.watch`
 * callback reads that outcome back off the emitted value itself — no
 * separate in-memory map. This still cannot make the *original* page
 * caller's in-flight promise survive an SW restart (an inherent MV3
 * limitation: a page's provider call has no way to survive its own
 * originating dispatcher call context dying either), but it does mean the
 * resolution data itself is never only-in-memory. See this task's final
 * report.
 *
 * Closing the approval window with its own close button counts as a
 * rejection: `WindowPort.onApprovalWindowClosed` writes a rejected outcome
 * the same way `resolveApproval` does, so the dApp hears back at once
 * instead of after `APPROVAL_TIMEOUT_MS`.
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
  kind: Exclude<ApprovalKind, "connect">;
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
 * approved `transferAoTokens` request — injected rather than imported
 * directly, so `ApprovalHandler` doesn't need to know how a transfer is
 * actually submitted (mirrors the existing `StoragePort`/`WindowPort`
 * ports-style injection this class already uses). Optional constructor
 * param: every existing call site/test that never exercises
 * `transferAoTokens` is unaffected.
 */
export interface AoTransferSubmitter {
  submitTransfer(req: { token: string; recipient: string; amount: string; fee: null; walletId: string }): Promise<{ txId: string }>;
}

export interface ConnectRequestInput {
  kind: "connect";
  requestedPermissions: PermissionType[];
}

export type CreateApprovalInput =
  | ({ origin: string; walletId: string } & ConnectRequestInput)
  | ({ origin: string; walletId: string } & SigningRequestInput);

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
  walletId: string;
  /** A tagged-binary encoded `SigningRequestInput`; `null` for a `connect` request. */
  signingInput: unknown;
  /** Set by `resolveApproval` immediately before the record is removed. */
  outcome?: ApprovalOutcome;
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

function buildConnectPreview(requestedPermissions: PermissionType[]): ConnectApprovalPreview {
  return { kind: "connect", requestedPermissions };
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

  constructor(
    private readonly storage: StoragePort,
    private readonly windows: WindowPort,
    private readonly transfers?: AoTransferSubmitter,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
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

  private async loadPending(): Promise<PendingApprovalRecord[]> {
    const raw = await this.storage.get<unknown>(PENDING_APPROVALS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (entry): entry is PendingApprovalRecord =>
        entry !== null &&
        typeof entry === "object" &&
        isValidApprovalRequest((entry as PendingApprovalRecord).request) &&
        typeof (entry as PendingApprovalRecord).walletId === "string",
    );
  }

  private async savePending(pending: PendingApprovalRecord[]): Promise<void> {
    await this.storage.set(PENDING_APPROVALS_KEY, pending);
  }

  /**
   * Origin -> wallet permission lookup. A connected origin's Grant must
   * still be present and unexpired for a `PROVIDER_METHODS` call to
   * proceed without a fresh approval prompt — revoking a Grant (or
   * letting it expire) ends all access it covered, per this task's
   * RELEVANT RULES.
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
   * (never inline in the popup — CLAUDE.md/ARCHITECTURE.md §3.2), and
   * resolves once `resolveApproval` has been called for it. Rejects on
   * explicit rejection or on timeout (a hung/abandoned approval window
   * must not hang the calling dApp forever).
   */
  async requestApproval(input: CreateApprovalInput): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const preview: ApprovalPreview =
      input.kind === "connect"
        ? buildConnectPreview(input.requestedPermissions)
        : await buildSigningPreview(input);

    const request: ApprovalRequest = {
      requestId,
      kind: input.kind,
      origin: input.origin,
      createdAt: Date.now(),
      preview,
    };

    const pending = await this.loadPending();
    pending.push({
      request,
      walletId: input.walletId,
      signingInput: input.kind === "connect" ? null : encodeTaggedBinary(input),
    });
    await this.savePending(pending);

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
      const timeout = setTimeout(() => {
        unwatch();
        void this.dropPending(requestId);
        void this.windows.closeApprovalWindow(requestId);
        reject(new Error("Approval request timed out — the approval window was not resolved in time."));
      }, APPROVAL_TIMEOUT_MS);

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
    if (this.resolving.has(requestId)) return;
    const pending = await this.loadPending();
    if (!pending.some((entry) => entry.request.requestId === requestId && !entry.outcome)) return;

    const outcome: ApprovalOutcome = { approved: false, error: "The approval window was closed." };
    await this.savePending(
      pending.map((entry) => (entry.request.requestId === requestId ? { ...entry, outcome } : entry)),
    );
    await this.dropPending(requestId);
  }

  private async dropPending(requestId: string): Promise<void> {
    const pending = await this.loadPending();
    await this.savePending(pending.filter((entry) => entry.request.requestId !== requestId));
  }

  /** `ProtocolMap.getApproval` — read-only, called by the approval window on mount. */
  async getApproval(req: { requestId: string }): Promise<ApprovalRequest> {
    const pending = await this.loadPending();
    const entry = pending.find((candidate) => candidate.request.requestId === req.requestId);
    if (!entry) {
      throw new Error(`No pending approval request with id "${req.requestId}".`);
    }
    return entry.request;
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
  async resolveApproval(req: { requestId: string; approved: boolean }): Promise<void> {
    const pending = await this.loadPending();
    const entry = pending.find((candidate) => candidate.request.requestId === req.requestId);
    if (!entry) {
      throw new Error(`No pending approval request with id "${req.requestId}".`);
    }

    if (this.resolving.has(req.requestId)) {
      throw new Error(`Approval request "${req.requestId}" is already being resolved.`);
    }
    this.resolving.add(req.requestId);
    try {
      let outcome: ApprovalOutcome;
      if (!req.approved) {
        outcome = { approved: false };
      } else {
        try {
          outcome = { approved: true, result: encodeTaggedBinary(await this.finalizeApproval(entry)) };
        } catch (error) {
          outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
        }
      }

      // Written in two steps (outcome attached, then removed) so a watcher
      // observing this key sees the outcome at least once before the record
      // disappears — see this class's doc comment. Re-read, because other
      // requests may have been added or removed while this one signed.
      const current = await this.loadPending();
      await this.savePending(
        current.map((candidate) =>
          candidate.request.requestId === req.requestId ? { ...candidate, outcome } : candidate,
        ),
      );
      await this.dropPending(req.requestId);
      if (outcome.error !== undefined) throw new Error(outcome.error);
      await this.windows.closeApprovalWindow(req.requestId);
    } finally {
      this.resolving.delete(req.requestId);
    }
  }

  private async finalizeApproval(entry: PendingApprovalRecord): Promise<unknown> {
    if (entry.request.kind === "connect") {
      return this.createGrant(entry);
    }
    return this.performSigning(entry);
  }

  private async createGrant(entry: PendingApprovalRecord): Promise<{ granted: PermissionType[] }> {
    const preview = entry.request.preview as ConnectApprovalPreview;
    const grants = await this.loadGrants();
    const withoutExisting = grants.filter((grant) => grant.origin !== entry.request.origin);

    const grant: Grant = {
      origin: entry.request.origin,
      walletId: entry.walletId,
      permissions: preview.requestedPermissions,
      createdAt: Date.now(),
      expiresAt: null,
      budget: null,
    };

    await this.saveGrants([...withoutExisting, grant]);
    return { granted: grant.permissions };
  }

  /**
   * Reads the already-unlocked signing key and performs the real
   * cryptographic operation the approved preview described — everything
   * `buildSigningPreview` computed (recipient/amount/payload hash/tags)
   * is display-only; the actual operation is re-derived here from
   * `signingInput`'s typed fields, never from the decoded preview.
   * Throws if the wallet isn't currently unlocked (`key-session.ts` has
   * no cached key for it) — a signing approval can no longer collect its
   * own password, so an approval on a locked wallet fails here rather
   * than prompting.
   */
  private async performSigning(entry: PendingApprovalRecord): Promise<unknown> {
    const input = decodeTaggedBinary(entry.signingInput) as SigningRequestInput | null;
    if (!input) {
      throw new Error(`Approval request "${entry.request.requestId}" has no signing input.`);
    }

    const cached = await getCachedKey(entry.walletId);
    if (!cached) {
      throw new Error(`Wallet "${entry.walletId}" is locked. Unlock it to continue.`);
    }
    const { jwk } = cached;

    if (input.kind === "transferAoTokens") {
      return this.performAoTransfer(entry.walletId, input);
    }

    const transaction: SignTransactionInput = {
      data: bytesToBase64(input.payload),
      target: input.target,
      quantity: input.quantity,
      tags: input.tags,
      reward: input.reward,
      last_tx: input.last_tx,
    };

    switch (input.kind) {
      case "sign": {
        return signTransaction(this.requireGatewayUrl(input), jwk, transaction);
      }

      case "dispatch": {
        return dispatchTransaction(this.requireGatewayUrl(input), this.bundlerUrl, jwk, transaction);
      }

      case "signDataItem": {
        const [dataItem] = input.dataItems ?? [];
        if (!dataItem) throw new Error("signDataItem requires a data item.");
        // Wander resolves to the raw signed item as an ArrayBuffer, which
        // aoconnect's createDataItemSigner parses directly.
        return toArrayBuffer(await signDataItem(jwk, dataItem));
      }

      case "batchSignDataItem": {
        const signed = await batchSignDataItem(jwk, input.dataItems ?? []);
        return signed.map(toArrayBuffer);
      }

      case "encrypt": {
        if (!input.encryptAlgorithm) {
          throw new Error("encrypt requires an algorithm.");
        }
        return encrypt(jwk, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
      }

      case "decrypt": {
        if (!input.encryptAlgorithm) {
          throw new Error("decrypt requires an algorithm.");
        }
        return decrypt(jwk, input.payload as Uint8Array<ArrayBuffer>, input.encryptAlgorithm);
      }

      case "signature": {
        return new Uint8Array(await vaultSignature(jwk, toArrayBuffer(input.payload), { saltLength: input.saltLength }));
      }

      case "signMessage": {
        return new Uint8Array(await vaultSignMessage(jwk, toArrayBuffer(input.payload), input.hashAlgorithm));
      }

      case "privateHash": {
        return new Uint8Array(await vaultPrivateHash(jwk, toArrayBuffer(input.payload), input.hashAlgorithm));
      }

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
  private async performAoTransfer(walletId: string, input: SigningRequestInput): Promise<{ id: string }> {
    if (!this.transfers) {
      throw new Error(
        "transferAoTokens is not wired to a transfer submitter — ApprovalHandler was constructed " +
          "without an AoTransferSubmitter.",
      );
    }
    if (input.token == null || input.recipient == null || input.amount == null) {
      throw new Error("A transferAoTokens approval is missing token/recipient/amount.");
    }

    const { txId } = await this.transfers.submitTransfer({
      token: input.token,
      recipient: input.recipient,
      amount: input.amount,
      fee: null,
      walletId,
    });
    return { id: txId };
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
    const pending = await this.loadPending();
    const rejected = new Set(
      pending
        .filter((entry) => !entry.outcome && !this.resolving.has(entry.request.requestId) && matches(entry))
        .map((entry) => entry.request.requestId),
    );
    if (rejected.size === 0) return;

    const outcome: ApprovalOutcome = { approved: false, error };
    await this.savePending(
      pending.map((entry) => (rejected.has(entry.request.requestId) ? { ...entry, outcome } : entry)),
    );
    const current = await this.loadPending();
    await this.savePending(current.filter((entry) => !rejected.has(entry.request.requestId)));
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
