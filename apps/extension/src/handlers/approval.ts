import {
  base64ToBytes,
  decryptFromEnvelope,
  zeroize,
  PERMISSION_TYPES,
  type ApprovalKind,
  type ApprovalPreview,
  type ApprovalRequest,
  type ConnectApprovalPreview,
  type Grant,
  type PermissionType,
  type SigningApprovalPreview,
  type StoragePort,
  type Wallet,
  type WindowPort,
} from "@gleam/core";

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
 */
const GRANTS_KEY = "local:grants";
const PENDING_APPROVALS_KEY = "session:pendingApprovals";
const APPROVAL_WINDOW_PATH = "/approval.html";
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const WALLETS_KEY = "local:wallets";

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

function isValidWallet(value: unknown): value is Wallet {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.address === "string";
}

/** A signing request's decoded intent — the input to `describeIntent`-style preview building. */
export interface SigningRequestInput {
  kind: Exclude<ApprovalKind, "connect">;
  /** Present for value-transfer-shaped calls (`sign` a transfer, `dispatch`). */
  recipient?: string | null;
  amount?: string | null;
  fee?: string | null;
  /** Raw bytes this request will sign/encrypt/decrypt, for the payload hash and decoded preview. */
  payload: Uint8Array;
  tags?: Array<{ name: string; value: string }>;
  /** `true` when the review screen must escalate to Irreversible-tier framing. */
  firstSeenOrHighRisk?: boolean;
}

export interface ConnectRequestInput {
  kind: "connect";
  requestedPermissions: PermissionType[];
}

export type CreateApprovalInput =
  | ({ origin: string; walletId: string } & ConnectRequestInput)
  | ({ origin: string; walletId: string } & SigningRequestInput);

interface ApprovalOutcome {
  approved: boolean;
  result?: unknown;
  error?: string;
}

interface PendingApprovalRecord {
  request: ApprovalRequest;
  walletId: string;
  /** Only set for signing requests — never persisted for a `connect` request past this point. */
  signingInput: SigningRequestInput | null;
  /** Set by `resolveApproval` immediately before the record is removed. */
  outcome?: ApprovalOutcome;
  /**
   * Staged by `unlockApprovalWallet` (`ProtocolMap`'s `APPROVAL_METHODS`
   * entry for exactly this purpose — see `protocol.ts`'s doc comment on
   * it) ahead of `resolveApproval({ requestId, approved: true })`, whose
   * own shape is locked to carry no password field. Cleared the instant
   * it's consumed by `performSigning`, and always cleared (not just on
   * success) once `resolveApproval` finishes with this record, so it
   * never lingers in session storage longer than the single resolution
   * call that needs it.
   */
  stagedPassword?: string;
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

async function buildSigningPreview(input: SigningRequestInput): Promise<SigningApprovalPreview> {
  const payloadHash = await sha256Hex(input.payload);
  return {
    kind: input.kind,
    recipient: input.recipient ?? null,
    amount: input.amount ?? null,
    fee: input.fee ?? null,
    decodedData: decodeDataPreview(input.payload),
    tags: input.tags ?? [],
    payloadHash,
  };
}

export class ApprovalHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly windows: WindowPort,
  ) {}

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

  private async loadWallet(walletId: string): Promise<Wallet> {
    const raw = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(raw) ? raw.filter(isValidWallet) : [];
    const wallet = wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      throw new Error(`No stored wallet with id "${walletId}".`);
    }
    return wallet;
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
      signingInput: input.kind === "connect" ? null : input,
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
        reject(new Error("Approval request timed out — the approval window was not resolved in time."));
      }, APPROVAL_TIMEOUT_MS);

      const unwatch = this.storage.watch<PendingApprovalRecord[]>(PENDING_APPROVALS_KEY, (value) => {
        const entry = (value ?? []).find((candidate) => candidate.request.requestId === requestId);
        if (!entry?.outcome) return;

        clearTimeout(timeout);
        unwatch();
        const { outcome } = entry;
        if (!outcome.approved) {
          reject(new Error("The request was rejected."));
        } else if (outcome.error) {
          reject(new Error(outcome.error));
        } else {
          resolve(outcome.result);
        }
      });
    });
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
   * `ProtocolMap.unlockApprovalWallet` — stages a password against a
   * pending signing request, ahead of `resolveApproval`. See
   * `PendingApprovalRecord.stagedPassword`'s doc comment for why this is
   * a separate call rather than a field on `resolveApproval` itself.
   */
  async stagePassword(req: { requestId: string; password: string }): Promise<void> {
    const pending = await this.loadPending();
    if (!pending.some((candidate) => candidate.request.requestId === req.requestId)) {
      throw new Error(`No pending approval request with id "${req.requestId}".`);
    }
    await this.savePending(
      pending.map((candidate) =>
        candidate.request.requestId === req.requestId
          ? { ...candidate, stagedPassword: req.password }
          : candidate,
      ),
    );
  }

  /**
   * `ProtocolMap.resolveApproval` — called only from the approval window
   * (`APPROVAL_METHODS`, enforced by the dispatcher choke point, not by
   * this handler). On a `connect` approval, creates and persists a real
   * `Grant`. On a signing approval, performs the actual signing operation
   * using the password staged by `unlockApprovalWallet` and returns the
   * result to the original caller. Either way, closes the approval
   * window once resolved so it doesn't linger.
   */
  async resolveApproval(req: { requestId: string; approved: boolean }): Promise<void> {
    const pending = await this.loadPending();
    const entry = pending.find((candidate) => candidate.request.requestId === req.requestId);
    if (!entry) {
      throw new Error(`No pending approval request with id "${req.requestId}".`);
    }

    let outcome: ApprovalOutcome;
    if (!req.approved) {
      outcome = { approved: false };
    } else {
      try {
        outcome = { approved: true, result: await this.finalizeApproval(entry) };
      } catch (error) {
        outcome = { approved: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Written in two steps (outcome attached, staged password cleared,
    // then removed) so a watcher observing this key sees the outcome at
    // least once before the record disappears — see this class's doc
    // comment. `stagedPassword` is cleared here unconditionally, not just
    // on the success path, so it never lingers past this call.
    await this.savePending(
      pending.map((candidate) =>
        candidate.request.requestId === req.requestId
          ? { ...candidate, outcome, stagedPassword: undefined }
          : candidate,
      ),
    );
    await this.dropPending(req.requestId);
    await this.windows.closeApprovalWindow(req.requestId);
  }

  private async finalizeApproval(entry: PendingApprovalRecord): Promise<unknown> {
    const password = entry.stagedPassword;
    if (entry.request.kind === "connect") {
      return this.createGrant(entry);
    }
    if (!password) {
      throw new Error("A password is required to sign this request.");
    }
    return this.performSigning(entry, password);
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
   * Decrypts the signing key and reports the fully-decoded intent that
   * was already approved (recipient/amount/payload hash/tags — everything
   * `buildSigningPreview` computed, which is exactly what the approval
   * screen showed the user before they signed). This proves the
   * password/vault/approval plumbing end-to-end.
   *
   * Scope gap (reported per this task's packet rather than silently
   * worked around): actually producing a valid ANS-104 signature
   * (`sign`/`dispatch`/`signDataItem`/`batchSignDataItem`) needs
   * `@dha-team/arbundles`, and `signature`/`encrypt`/`decrypt` need
   * `arweave-js`'s `crypto` driver — both already `packages/core`
   * dependencies (`handlers/upload.ts` already uses the former via
   * `core/policy/upload-submit.ts`), but neither is resolvable from
   * `apps/extension` (`apps/extension/package.json` declares neither, and
   * is outside this task's ALLOWED SCOPE to widen — the same "shared
   * workspace config, no layer owns it" class of gap `onboarding-unlock`
   * hit with `@webext-core/messaging`, and `upload`'s own task hit with
   * this identical pair of packages, per its own debt note on
   * `core/policy/upload-submit.ts`). Building the actual signature
   * requires either (a) a `chore(workspace)` commit adding
   * `arweave`/`@dha-team/arbundles` to `apps/extension/package.json`, or
   * (b) a new `core/signing/**`-shaped scope grant so this logic can live
   * in `packages/core` instead and be called through `@gleam/core`'s
   * barrel, mirroring `submitUploadToBundler`. Per this task's HONESTY
   * requirement, this throws a specific, named "not implemented" error
   * rather than fabricating a signature or silently returning the
   * plaintext as if it were signed.
   */
  private async performSigning(entry: PendingApprovalRecord, password: string): Promise<unknown> {
    const input = entry.signingInput;
    if (!input) {
      throw new Error(`Approval request "${entry.request.requestId}" has no signing input.`);
    }

    const wallet = await this.loadWallet(entry.walletId);
    if (!wallet.encryptedKeyfile) {
      throw new Error(`Wallet "${entry.walletId}" has no key material to sign with.`);
    }
    // Proves the password actually unlocks this wallet's key material
    // before reporting anything back — a wrong password must fail here,
    // not silently produce a bogus "success."
    const plaintext = await decryptFromEnvelope(wallet.encryptedKeyfile, password, wallet.id, wallet.address);
    zeroize(plaintext);

    throw new Error(
      `Signing kind "${input.kind}" is not implemented yet — this build verifies the password and ` +
        "approval flow, but producing a real signature needs arweave-js/@dha-team/arbundles wired " +
        "into apps/extension, which is outside this task's ALLOWED SCOPE. See this task's final report.",
    );
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

export function decodeBase64Payload(data: string): Uint8Array {
  return base64ToBytes(data);
}
