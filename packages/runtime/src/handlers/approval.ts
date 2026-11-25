import {
  addressFromOwner,
  base64ToBytes,
  base64UrlToBytes,
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
  prepareDataItem,
  prepareDataItems,
  prepareDispatch,
  prepareSignTransaction,
  HARDWARE_MESSAGE_HASH,
  signMessage as vaultSignMessage,
  signPayloadWithSigner,
  verifyDeviceSignature,
  WALLET_APPROVAL_ORIGIN,
  type ApprovalPresenterPort,
  type ApprovalPreview,
  type ApprovalRequest,
  type Grant,
  type HardwareDevice,
  type HardwareWalletMethod,
  type NameTargetRequest,
  type WalletMethod,
  type PermissionType,
  type StoragePort,
  type UnsignedPayload,
  errorMessage,
} from "@gleam/core";
import { APPROVAL_TIMEOUT_MS } from "@gleam/messaging/src/page-protocol.ts";
import { updateStored } from "../storage-update";
import { buildAttestMessage, buildOwnershipTransaction } from "@gleam/core/src/points/index.ts";
import { attestationId, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import type { AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import type { ApprovalShown } from "@gleam/messaging/src/protocol.ts";
import type { KeySession } from "./key-session";
import { attestFailure } from "./attest-errors";
import type { SubmitTransferRequest } from "./transfer";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { safeSiteIconUrl } from "./site-wallet";
import { dappError } from "../dapp-error";
import { dataItemOf, summarize, transactionOf } from "./prepared-check";
import { GrantStore } from "./approval-grants";
import {
  ApprovalDeclinedError,
  type AddTokenRequestInput,
  type CreateApprovalInput,
  type DeviceNameTargetSubmitter,
  type DeviceTransferSubmitter,
  type PointsDeviceProof,
  type ScanAttestationSubmitter,
  type SigningRequestInput,
  type TokenWatchList,
  type TransferSubmitter,
  type WalletApprovalInput,
  type WalletTransferRequest,
} from "./approval-types";
import {
  DEVICE_GRACE_MS,
  DEVICE_SIGNED_KINDS,
  DISCONNECTED_OUTCOME,
  needsGrant,
  PENDING_APPROVALS_KEY,
  RESOLVING_RECHECK_MS,
  RESULT_ONLY_KINDS,
  reviewTimeoutMs,
  signsForActiveWallet,
  SITE_DISCONNECTED,
  TIMED_OUT,
  validPending,
  WALLET_SWITCHED,
  type ApprovalOutcome,
  type PendingDeviceSigning,
  type PendingApprovalRecord,
} from "./approval-records";
import {
  fromStored,
  PENDING_BYTES_LIMIT,
  PENDING_BYTES_PER_ORIGIN,
  storedSize,
  toStored,
} from "./pending-codec";
import {
  assertPreparedMatches,
  textDecoder,
  toArrayBuffer,
  toWirePayload,
  transactionInputOf,
} from "./approval-prepared";
import {
  buildAddTokenPreview,
  buildConnectPreview,
  buildScanAttestationPreview,
  buildSigningPreview,
  decodeText,
  parsedAttestationOf,
  previewCollectibleId,
} from "./approval-preview";

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
interface HardwareWalletInfo {
  method: HardwareWalletMethod;
  device: HardwareDevice | null;
  address: string;
  publicKey: string;
}

export class ApprovalHandler {
  /**
   * Requests `resolveApproval` is finishing. Dismissing the approval UI while an
   * approved request signs or posts must not also report it as rejected.
   */
  private readonly resolving = new Set<string>();

  /** Set while a scan attestation is being opened or awaited, so two can't race past the pending check. */
  private attesting = false;

  private readonly grants: GrantStore;

  constructor(
    private readonly storage: StoragePort,
    private readonly keySession: Pick<KeySession, "getSigner" | "getWalletMethod" | "getStoredWallet" | "isVaultLocked">,
    private readonly presenter: ApprovalPresenterPort,
    private readonly transfers?: TransferSubmitter,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
    private readonly activeWalletId: () => Promise<string | null> = async () => null,
    private readonly tokens?: TokenWatchList,
    private readonly attestations?: ScanAttestationSubmitter,
  ) {
    this.grants = new GrantStore(storage, keySession, activeWalletId);
    presenter.onDismissed((requestId) => {
      void this.rejectDismissed(requestId);
    });
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
    return this.grants.findActive(origin);
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
    // Like `findLive`: a record that already carries an outcome is settled,
    // not pending, so it must not be read or resolved again.
    if (!entry || entry.outcome) {
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

  /**
   * `ProtocolMap.getApprovalData`: the whole text of the data a request
   * signs, for a preview that shows only its start. `index` picks a data
   * item; without it, the request's own payload. `null` where the bytes
   * aren't text or nothing is signed there.
   */
  async getApprovalData(req: { requestId: string; index?: number }): Promise<{ text: string | null }> {
    const entry = await this.findPending(req.requestId);
    if (entry.request.kind === "connect" || entry.request.kind === "addToken" || entry.signingInput === null) return { text: null };
    const input = this.signingInputOf(entry);
    if (input.kind === "scanAttestation") return { text: null };
    if (req.index === undefined) return { text: decodeText(input.payload) };
    const items =
      input.kind === "signDataItem" ? input.dataItems?.slice(0, 1) : input.kind === "batchSignDataItem" ? input.dataItems : undefined;
    const item = items?.[req.index];
    return { text: item ? decodeText(base64ToBytes(item.data)) : null };
  }

  /** The request as the approval UI sees it: with the device's payloads once it waits on one. */
  private async requestView(entry: PendingApprovalRecord): Promise<ApprovalRequest> {
    const { origin, kind } = entry.request;
    const siteIcon =
      origin === WALLET_APPROVAL_ORIGIN || kind === "connect" ? null : ((await this.findActiveGrant(origin))?.icon ?? null);
    const request = siteIcon ? { ...entry.request, siteIcon } : entry.request;
    // The wallet this request signs or sends from, pinned when the request
    // was made. The approval shows it as From: the active wallet can be a
    // different one by the time the window loads — a wallet-origin transfer
    // survives a switch (`signsForActiveWallet` excludes Gleam's own
    // requests from cancel-on-switch), so deriving From from the active
    // wallet shows the wrong sender. Connect and addToken sign nothing,
    // so they carry none; a pinned wallet that no longer exists leaves the
    // view without one, and the UI then shows no From.
    const signs = kind !== "connect" && kind !== "addToken";
    const source = signs && entry.walletId ? await this.keySession.getStoredWallet(entry.walletId) : null;
    const view = source ? { ...request, signingWallet: { id: source.id, address: source.address } } : request;
    if (!entry.device || !entry.walletId) return view;
    const wallet = await this.hardwareWallet(entry.walletId);
    const payloads = fromStored(entry.device.payloads) as UnsignedPayload[];
    return {
      ...view,
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
          // A window opened while unlocked stays open across a lock, so
          // approving re-checks the lock instead of trusting the window.
          if (await this.keySession.isVaultLocked()) throw new Error(userErrorMessage("keyringLocked"));
          if (await this.signsOnDevice(entry)) {
            const view = await this.startDeviceSigning(entry);
            if (!(await this.lapsedSince(entry))) return view;
            outcome = DISCONNECTED_OUTCOME;
          } else {
            if (entry.attempted) throw new Error(userErrorMessage("approvalResolving", { id: req.requestId }));
            await this.updatePending((current) =>
              current.map((candidate) => (candidate.request.requestId === req.requestId ? { ...candidate, attempted: true as const } : candidate)),
            );
            result = await this.finalizeApproval(entry);
            outcome = await this.withheldIfLapsed(entry, { approved: true, result: toStored(result) });
          }
        } catch (error) {
          outcome = { approved: true, error: errorMessage(error) };
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
        // Marked once the signatures check out, so a wrong one can be
        // retried but a run a restart or failed save cut short never posts twice.
        if (entry.attempted) throw new Error(userErrorMessage("approvalResolving", { id: req.requestId }));
        await this.updatePending((current) =>
          current.map((candidate) => (candidate.request.requestId === req.requestId ? { ...candidate, attempted: true as const } : candidate)),
        );
        result = await this.finishDeviceSigning(walletId, wallet, this.signingInputOf(entry), payloads, signatures);
        outcome = await this.withheldIfLapsed(entry, { approved: true, result: toStored(result) });
      } catch (error) {
        outcome = { approved: true, error: errorMessage(error) };
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
      case "setNameTarget":
        return [await this.deviceNameTargets().prepareDeviceNameTarget(this.nameTargetRequestOf(walletId, input), owner)];
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
      case "setNameTarget":
        return this.deviceNameTargets().finishDeviceNameTarget(this.nameTargetRequestOf(walletId, input), payload!, signature!, owner);
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

  private deviceNameTargets(): DeviceNameTargetSubmitter {
    const transfers = this.transfers;
    if (!transfers?.prepareDeviceNameTarget || !transfers.finishDeviceNameTarget) {
      throw new Error(dappError("Hardware wallet name changes aren't wired. ApprovalHandler was constructed without them."));
    }
    return transfers as DeviceNameTargetSubmitter;
  }

  /** Built from the stored request the user approved, never from its preview. */
  private nameTargetRequestOf(walletId: string, input: SigningRequestInput): NameTargetRequest {
    const name = input.nameTarget;
    if (!name) throw new Error(dappError("A setNameTarget approval is missing its name."));
    return { walletId, carrier: name.carrier, label: name.label, target: name.target, fee: input.fee ?? null };
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
    return this.requestWalletApproval<{ txId: string }>({
      kind: "transfer",
      walletId: req.walletId,
      recipient: req.recipient,
      amount: req.amount,
      fee: req.fee,
      token: req.token,
      tokenDenomination: req.tokenDenomination ?? null,
      tokenTicker: req.tokenTicker ?? null,
      collectible: req.collectible ?? null,
      ...(req.tokenImpersonating ? { tokenImpersonating: true } : {}),
    });
  }

  /**
   * A name change from the popup by a hardware wallet: reviewed and signed
   * in the approval window, with Gleam as the origin. Resolves to the
   * posted `set`'s `{ txId }`.
   */
  async requestNameTarget(req: NameTargetRequest): Promise<{ txId: string }> {
    return this.requestWalletApproval<{ txId: string }>({
      kind: "setNameTarget",
      walletId: req.walletId,
      fee: req.fee,
      nameTarget: { carrier: req.carrier, label: req.label, target: req.target },
    });
  }

  /**
   * Has a hardware wallet sign the Gleam Points ownership transaction for
   * `message` (`core/points/ownership.ts`) in the approval window. Resolves
   * once the device's signature has verified against the wallet's key.
   */
  async requestPointsProof(req: { walletId: string; message: string }): Promise<PointsDeviceProof> {
    return this.requestWalletApproval<PointsDeviceProof>({
      kind: "pointsProof",
      walletId: req.walletId,
      payload: new TextEncoder().encode(req.message),
    });
  }

  /** An approval the wallet itself asks for, with Gleam as the origin and no dApp payload or tags. */
  private async requestWalletApproval<T>(input: WalletApprovalInput): Promise<T> {
    const result = await this.requestApproval({
      ...input,
      origin: WALLET_APPROVAL_ORIGIN,
      payload: input.payload ?? new Uint8Array(),
      tags: [],
    } as CreateApprovalInput);
    return result as T;
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
      return this.grants.createFromConnect(entry);
    }
    if (entry.request.kind === "addToken") {
      return this.addToken(entry);
    }
    return this.performSigning(entry);
  }

  /**
   * Grants `origin` from the popup's "Use Gleam here", where the user
   * picked the permissions themselves, so no approval window opens.
   */
  grantSite(req: { origin: string; permissions: PermissionType[]; favIconUrl?: string | null }): Promise<Grant> {
    return this.grants.grantSite(req);
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

      // A keyfile signs a name change in TransferHandler.setNameTarget, after the popup's review.
      case "setNameTarget":
        throw new Error(dappError("Only a hardware wallet changes a name through the approval window."));

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
    const origins = await this.grants.revokeAll();
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
    await this.grants.revoke(req.origin);
    await this.rejectPendingWhere((entry) => needsGrant(entry) && entry.request.origin === req.origin, SITE_DISCONNECTED);
  }

  /** Read-only list of connected origins, for the `connected-apps` popup view. */
  async getConnectedApps(): Promise<Grant[]> {
    return this.grants.load();
  }
}
