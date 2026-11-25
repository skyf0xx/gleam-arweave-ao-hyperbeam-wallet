import {
  bytesToBase64Url,
  INVITE_REQUIRED_MESSAGE,
  capabilityRefusal,
  isHardwareWalletMethod,
  unsupportedOperationMessage,
  type BadgePort,
  type DeviceKeyPort,
  signMessage,
  type InviteRedeemResult,
  type InviteUnlock,
  type PointsMembership,
  type PointsScores,
  type PointsSharePrompt,
  type Signer,
  type StoragePort,
  type TimerPort,
  type WalletMethod,
} from "@gleam/core";
import {
  buildAttestMessage,
  buildDeviceMessage,
  buildLeaveMessage,
  buildRedeemMessage,
  buildRegisterMessage,
  isValidInviteCode,
  normalizeInviteCode,
  signDeviceMessage,
  type PointsProofKind,
} from "@gleam/core/src/points/index.ts";
import { attestationId, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import type { SiteAttestResponse } from "@gleam/messaging/src/site-protocol.ts";
import { attestFailure, serverAttestFailure, serverReason } from "./attest-errors";
import type { AttestationCheck } from "@gleam/messaging/src/protocol.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { updateStored } from "../storage-update";
import { dappError } from "../dapp-error";
import {
  attestReplySchema,
  errorBodySchema,
  joinReplySchema,
  redeemReplySchema,
  scoresReplySchema,
} from "./points-replies";
import { storedRecord, without } from "./points-records";
import {
  POINTS_CLAIM_PENDING_KEY,
  POINTS_REVEAL_SEEN_KEY,
  POINTS_SEATS_SEEN_KEY,
  POINTS_SHARE_SEEN_KEY,
  PointsSeen,
} from "./points-seen";

/** Per-install Gleam Points state. `registered` flips once any wallet registers. */
export interface PointsDeviceState {
  registered: boolean;
  lastHeartbeatAt: number | null;
}

export const POINTS_DEVICE_STATE_KEY = "local:points:device";
export const POINTS_MEMBERSHIPS_KEY = "local:points:memberships";
/** An invite code the site handed over on install, kept until a wallet joins. */
export const POINTS_PENDING_INVITE_KEY = "local:points:pendingInviteCode";
/** The outcome of the install-time invite redemption; `ok` is the unlock. */
export const POINTS_INVITE_UNLOCK_KEY = "local:points:inviteUnlock";

/** Every per-install Points storage key, so a wipe can remove them all at once. */
export const POINTS_STORAGE_KEYS = [
  POINTS_DEVICE_STATE_KEY,
  POINTS_MEMBERSHIPS_KEY,
  POINTS_PENDING_INVITE_KEY,
  POINTS_INVITE_UNLOCK_KEY,
  POINTS_REVEAL_SEEN_KEY,
  POINTS_CLAIM_PENDING_KEY,
  POINTS_SHARE_SEEN_KEY,
  POINTS_SEATS_SEEN_KEY,
] as const;

/**
 * A wallet earns only if its install sent a heartbeat in the 3 days before
 * a snapshot (POINTS.md § Rules). One every ~20 hours keeps a margin even
 * when Chrome only runs for part of the day.
 */
const HEARTBEAT_INTERVAL_MS = 20 * 3_600_000;

const ATTEST_TIMEOUT_MS = 30_000;

function failureOf(response: SiteAttestResponse): AttestationCheck {
  return { ok: false, error: response.ok ? userErrorMessage("attestationRefused") : response.error };
}

/** A wallet's signed proof that it owns its address, in the body shape `/register`, `/leave` and `/attestations` take. */
export interface OwnershipProof {
  owner: string;
  address: string;
  message: string;
  signature: string;
  proof: PointsProofKind;
}

export interface PointsHandlerDeps {
  storage: StoragePort;
  deviceKey: DeviceKeyPort;
  apiUrl: string;
  /** The unlocked wallet's signer, or null if it's locked. */
  signer: (walletId: string) => Promise<Signer | null>;
  /** The stored wallet's method, or null when it is unknown. */
  walletMethod: (walletId: string) => Promise<WalletMethod | null>;
  /**
   * A hardware wallet's signature over the ownership transaction for the
   * message built from its address, made on the device in the approval
   * window.
   */
  deviceProof?: (req: {
    walletId: string;
    message: (address: string) => string;
  }) => Promise<{ owner: string; address: string; signature: string; message: string }>;
  badge: BadgePort;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class PointsHandler {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly seen: PointsSeen;

  constructor(private readonly deps: PointsHandlerDeps) {
    this.seen = new PointsSeen(deps.storage, deps.badge, () => this.getMemberships());
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? Date.now;
  }

  async loadState(): Promise<PointsDeviceState> {
    const stored = await this.deps.storage.get<PointsDeviceState>(POINTS_DEVICE_STATE_KEY);
    return {
      registered: stored?.registered === true,
      lastHeartbeatAt: typeof stored?.lastHeartbeatAt === "number" ? stored.lastHeartbeatAt : null,
    };
  }

  async getMemberships(): Promise<Record<string, PointsMembership>> {
    return membershipsOf(await this.deps.storage.get<unknown>(POINTS_MEMBERSHIPS_KEY));
  }

  /**
   * Registers a wallet with the points API. A hand-typed `inviteCode`
   * wins over one the site handed over. The server credits a code only on
   * an install's first wallet, so the pending code is cleared after any
   * successful join. Registering counts as a heartbeat.
   */
  async join(req: { walletId: string; inviteCode?: string }): Promise<PointsMembership> {
    await this.requirePointsCapability(req.walletId, JOIN);
    const typed = req.inviteCode?.trim() ? normalizeInviteCode(req.inviteCode) : null;
    if (typed !== null && !isValidInviteCode(typed)) throw new Error(userErrorMessage("inviteCodeInvalid"));
    const inviteCode = typed ?? (await this.pendingInvite());

    const device = await this.deps.deviceKey.loadOrCreate();
    const message = buildRegisterMessage({
      deviceKeyThumbprint: device.id,
      inviteCode,
      issuedAt: Math.floor(this.now() / 1000),
    });
    const proof = await this.proveOwnership(req.walletId, JOIN, () => message);
    const response = await this.postJson("/register", { ...proofBody(proof), devicePublicKey: device.publicKey });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const body = errorBodySchema.parse(raw);
      if (body?.code === "invite_required") {
        // A stored "ok" unlock would make the gate's redeem return early
        // without a code the server accepts.
        await this.deps.storage.remove(POINTS_INVITE_UNLOCK_KEY);
        await this.deps.storage.remove(POINTS_PENDING_INVITE_KEY);
        throw new Error(INVITE_REQUIRED_MESSAGE);
      }
      throw new Error(userErrorMessage("pointsJoinFailed", { reason: serverReason(body, response.status) }));
    }
    const joined = joinReplySchema.safeParse(raw);
    if (!joined.success || joined.data.address !== proof.address) {
      throw new Error(userErrorMessage("pointsUnexpectedResponse"));
    }
    const body = joined.data;

    const membership: PointsMembership = {
      address: proof.address,
      inviteCode: body.inviteCode,
      referred: body.referred,
      joinedAt: this.now(),
    };
    await updateStored(this.deps.storage, POINTS_MEMBERSHIPS_KEY, (current) => ({
      ...storedRecord(current),
      [req.walletId]: membership,
    }));
    await this.setDeviceState(true);
    await this.deps.storage.remove(POINTS_PENDING_INVITE_KEY);
    await this.seen.setClaimPending({ walletId: req.walletId, pending: false });
    return membership;
  }

  private async requirePointsCapability(walletId: string, action: string): Promise<void> {
    const method = await this.deps.walletMethod(walletId);
    const refusal = method === null ? null : capabilityRefusal(method, "points", action);
    if (refusal) throw new Error(refusal);
  }

  /**
   * A keyfile signs `message` with `signMessage`. A hardware wallet can't
   * sign messages, so it signs the ownership transaction on the device
   * instead (`core/points/ownership.ts`).
   */
  private async proveOwnership(
    walletId: string,
    action: PointsAction,
    buildMessage: (address: string) => string,
  ): Promise<OwnershipProof> {
    const method = await this.deps.walletMethod(walletId);
    if (method !== null && isHardwareWalletMethod(method)) {
      if (!this.deps.deviceProof) throw new Error(unsupportedOperationMessage(action));
      return { ...(await this.deps.deviceProof({ walletId, message: buildMessage })), proof: "transaction" };
    }
    const signer = await this.deps.signer(walletId);
    if (!signer) throw new Error(userErrorMessage("unlockToAction", { action }));
    const message = buildMessage(signer.address);
    const signature = await signMessage(signer, new TextEncoder().encode(message).buffer as ArrayBuffer);
    return {
      owner: signer.owner,
      address: signer.address,
      message,
      signature: bytesToBase64Url(new Uint8Array(signature)),
      proof: "message",
    };
  }

  /**
   * Signs a community scan attestation (SCANS.md § The attestation) the
   * way registration is signed, and submits it. Refusals from the points
   * API come back as a failed response rather than a throw, so the caller
   * can tell the user which one it was; only a failure to sign throws.
   */
  async attest(req: { walletId: string; attestation: ParsedAttestation }): Promise<SiteAttestResponse> {
    await this.requirePointsCapability(req.walletId, ATTEST);
    const message = buildAttestMessage(req.attestation.release, await attestationId(req.attestation));
    const proof = await this.proveOwnership(req.walletId, ATTEST, () => message);
    return this.submitAttestation(req.attestation, proof);
  }

  /**
   * `POST /attestations/check`: the server's dry run of the local checks plus the
   * latest release, the challenge's expiry and use, and (given the wallet's address) whether it already attested. Asked before a signature
   * is requested, so a hardware wallet user isn't told it failed only after
   * signing on the device.
   */
  async checkAttestation(attestation: ParsedAttestation, address?: string): Promise<AttestationCheck> {
    let response: Response;
    let raw: unknown;
    try {
      response = await this.postJson("/attestations/check", address ? { attestation, address } : { attestation }, {
        signal: AbortSignal.timeout(ATTEST_TIMEOUT_MS),
      });
      raw = await response.json().catch(() => null);
    } catch {
      return failureOf(attestFailure("offline", attestation.release));
    }
    if (!response.ok) return failureOf(serverAttestFailure(response.status, errorBodySchema.parse(raw), attestation.release));
    return { ok: true };
  }

  /** `POST /attestations` with a proof already made, by `attest` or on a hardware wallet in the approval window. */
  async submitAttestation(attestation: ParsedAttestation, proof: OwnershipProof): Promise<SiteAttestResponse> {
    const id = await attestationId(attestation);
    if (proof.message !== buildAttestMessage(attestation.release, id)) {
      throw new Error(userErrorMessage("attestationSignedMismatch"));
    }
    let response: Response;
    let raw: unknown;
    try {
      // The approval window and the site's reply both wait on the timeout.
      response = await this.postJson("/attestations", { attestation, ...proofBody(proof) }, { signal: AbortSignal.timeout(ATTEST_TIMEOUT_MS) });
      raw = await response.json().catch(() => null);
    } catch {
      return attestFailure("offline", attestation.release);
    }
    if (!response.ok) return serverAttestFailure(response.status, errorBodySchema.parse(raw), attestation.release);
    const reply = attestReplySchema.safeParse(raw);
    if (!reply.success || reply.data.attestationId !== id) return attestFailure("offline", attestation.release);
    const { points, paid, paidPlacesLeft, unpaidReason } = reply.data;
    return {
      ok: true,
      attestationId: id,
      points,
      paid,
      unpaidReason: unpaidReason ?? null,
      paidPlacesLeft,
    };
  }

  getClaimPending(): Promise<string[]> {
    return this.seen.getClaimPending();
  }

  setClaimPending(req: { walletId: string; pending: boolean }): Promise<void> {
    return this.seen.setClaimPending(req);
  }

  getRevealSeen(): Promise<string[]> {
    return this.seen.getRevealSeen();
  }

  markRevealSeen(req: { walletId: string }): Promise<void> {
    return this.seen.markRevealSeen(req);
  }

  getShareSeen(): Promise<Record<string, PointsSharePrompt[]>> {
    return this.seen.getShareSeen();
  }

  markShareSeen(req: { walletId: string; prompt: PointsSharePrompt }): Promise<void> {
    return this.seen.markShareSeen(req);
  }

  getSeatsSeen(): Promise<Record<string, number>> {
    return this.seen.getSeatsSeen();
  }

  markSeatsSeen(req: { walletId: string; seats: number }): Promise<void> {
    return this.seen.markSeatsSeen(req);
  }

  async getInviteUnlock(): Promise<InviteUnlock | null> {
    return this.deps.storage.get<InviteUnlock>(POINTS_INVITE_UNLOCK_KEY);
  }

  /**
   * Redeems `code` for this install with a device-signed `POST
   * /invite/redeem` and stores the outcome. An already unlocked install
   * returns its stored unlock without asking again. A request that gets no
   * verdict (network error, 429, 5xx) is stored as `offline` so the gate
   * can retry; the code is checked here only for format.
   */
  async redeemInvite(rawCode: string): Promise<InviteUnlock> {
    const code = normalizeInviteCode(rawCode);
    if (!isValidInviteCode(code)) throw new Error(userErrorMessage("inviteCodeInvalid"));
    const existing = await this.getInviteUnlock();
    if (existing?.result === "ok") return existing;

    const { result, kind } = await this.requestRedeem(code);
    const unlock: InviteUnlock = { code, result, at: this.now() };
    // eslint-disable-next-line gleam/no-storage-read-modify-write -- the server's verdict replaces the stored one
    await this.deps.storage.set(POINTS_INVITE_UNLOCK_KEY, unlock);
    // The claim step applies this code when the first wallet joins. A drop
    // code has no referrer, so it never becomes the pending code. A code
    // whose kind is unknown (an older server, or no answer yet) is kept:
    // `join` sends it and the server decides.
    if ((result === "ok" || result === "offline") && kind !== "drop") {
      // eslint-disable-next-line gleam/no-storage-read-modify-write -- a whole-value write, not derived from the read
      await this.deps.storage.set(POINTS_PENDING_INVITE_KEY, code);
    }
    return unlock;
  }

  /**
   * An install that has a vault never meets the gate, including after it
   * resets or deletes its last wallet and has to import again. Such an
   * install is stored as unlocked with an empty code, since it redeemed
   * none.
   */
  async markUnlockedForVault(): Promise<void> {
    if ((await this.getInviteUnlock())?.result === "ok") return;
    // eslint-disable-next-line gleam/no-storage-read-modify-write -- an "ok" written over "ok" changes nothing
    await this.deps.storage.set<InviteUnlock>(POINTS_INVITE_UNLOCK_KEY, { code: "", result: "ok", at: this.now() });
  }

  /** The code the claim step will apply, or null if there is none. */
  async pendingInvite(): Promise<string | null> {
    const pending = await this.deps.storage.get<string>(POINTS_PENDING_INVITE_KEY);
    return typeof pending === "string" && isValidInviteCode(pending) ? pending : null;
  }

  private async requestRedeem(code: string): Promise<{ result: InviteRedeemResult; kind?: "member" | "drop" }> {
    try {
      const device = await this.deps.deviceKey.loadOrCreate();
      const message = buildRedeemMessage(code, Math.floor(this.now() / 1000));
      const response = await this.postJson("/invite/redeem", {
        code,
        message,
        signature: await signDeviceMessage(device.privateKey, message),
        devicePublicKey: device.publicKey,
      });
      if (!response.ok) return { result: "offline" };
      const reply = redeemReplySchema.safeParse(await response.json().catch(() => null));
      if (!reply.success) return { result: "offline" };
      return { result: reply.data.result, kind: reply.data.kind };
    } catch {
      return { result: "offline" };
    }
  }

  /**
   * Deletes the wallet's points data on the server, then forgets the
   * membership. Once no wallet on this install is a member, heartbeats
   * stop. The device key is kept: the server no longer knows it, and a
   * later join reuses it.
   */
  async leave(req: { walletId: string }): Promise<void> {
    await this.requirePointsCapability(req.walletId, LEAVE);
    const issuedAt = Math.floor(this.now() / 1000);
    const proof = await this.proveOwnership(req.walletId, LEAVE, (address) => buildLeaveMessage(address, issuedAt));
    const response = await this.postJson("/leave", proofBody(proof));
    if (!response.ok) {
      const body = errorBodySchema.parse(await response.json().catch(() => null));
      throw new Error(userErrorMessage("pointsLeaveFailed", { reason: serverReason(body, response.status) }));
    }

    const remaining = await updateStored(this.deps.storage, POINTS_MEMBERSHIPS_KEY, (raw) =>
      without(membershipsOf(raw), req.walletId),
    );
    await this.seen.forget(req.walletId);
    if (Object.keys(remaining ?? {}).length === 0) {
      await this.setDeviceState(false);
    }
  }

  /**
   * Reads this install's standing with a device-signed `POST /me`. Returns
   * null before any wallet has joined, or once the server has dropped this
   * device, since it doesn't know the device then.
   */
  async scores(): Promise<PointsScores | null> {
    if (!(await this.loadState()).registered) return null;
    const response = await this.postDeviceSigned("me");
    if (response.status === 404) {
      // The server forgot this device (a leave on another install deletes the wallet everywhere), so the local memberships no longer mean anything.
      // Queued like join's update, so a join in flight can't write the forgotten memberships back.
      await updateStored(this.deps.storage, POINTS_MEMBERSHIPS_KEY, () => ({}));
      await this.setDeviceState(false);
      return null;
    }
    if (!response.ok) throw new Error(userErrorMessage("pointsLoadFailed", { status: response.status }));
    const raw: unknown = await response.json();
    if (!scoresReplySchema.safeParse(raw).success) throw new Error(userErrorMessage("pointsUnexpectedResponse"));
    const body = raw as PointsScores;
    await this.seen.syncSeats(body).catch((error: unknown) => console.error("Gleam Points seat check failed:", error));
    return body;
  }

  /**
   * Re-reads the seat counts from the points API (journey F) so the
   * toolbar dot appears without the popup open. Does nothing before a
   * wallet has joined.
   */
  async checkSeats(): Promise<void> {
    await this.scores();
  }

  /**
   * Sends a heartbeat if this install has registered a wallet and the last
   * one is older than the interval. Returns whether one was sent. A 404
   * means the server no longer knows this device, so the install is
   * marked unregistered and the UI offers to join again.
   */
  async heartbeatIfDue(): Promise<boolean> {
    const state = await this.loadState();
    if (!state.registered) return false;
    if (state.lastHeartbeatAt !== null && this.now() - state.lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return false;

    const response = await this.postDeviceSigned("heartbeat");

    if (response.status === 404) {
      await this.setDeviceState(false);
      return false;
    }
    if (!response.ok) throw new Error(dappError(`Points heartbeat failed (HTTP ${response.status}).`));

    await this.setDeviceState(true);
    return true;
  }

  private async postDeviceSigned(kind: "heartbeat" | "me"): Promise<Response> {
    const device = await this.deps.deviceKey.loadOrCreate();
    const message = buildDeviceMessage(kind, Math.floor(this.now() / 1000));
    return this.postJson(`/${kind}`, {
      deviceId: device.id,
      message,
      signature: await signDeviceMessage(device.privateKey, message),
    });
  }

  private postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
    return this.fetchImpl(`${this.deps.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    });
  }

  private async setDeviceState(registered: boolean): Promise<void> {
    // eslint-disable-next-line gleam/no-storage-read-modify-write -- a whole-value write, not derived from the read
    await this.deps.storage.set<PointsDeviceState>(POINTS_DEVICE_STATE_KEY, {
      registered,
      lastHeartbeatAt: registered ? this.now() : null,
    });
  }
}

type PointsAction = typeof JOIN | typeof LEAVE | typeof ATTEST;
const JOIN = "join Gleam Points";
const LEAVE = "leave Gleam Points";
const ATTEST = "sign a scan attestation";

/** A keyfile's body omits `proof`, which the server reads as `message`. */
function proofBody({ owner, message, signature, proof }: OwnershipProof): Record<string, string> {
  return proof === "message" ? { owner, message, signature } : { owner, message, signature, proof };
}

const POINTS_HEARTBEAT_ALARM_NAME = "points-heartbeat";

/**
 * Checks every 6 hours, plus once whenever the service worker starts, so
 * a browser that was closed through the scheduled time still sends a
 * heartbeat soon after it opens. `heartbeatIfDue` decides whether to
 * actually send.
 */
export function registerPointsHeartbeatAlarm(handler: PointsHandler, timer: TimerPort): void {
  timer.every(POINTS_HEARTBEAT_ALARM_NAME, 6 * 60, () => {
    void runHeartbeat(handler);
  });
  void runHeartbeat(handler);
}

/**
 * The same tick refreshes seat counts, so the toolbar dot rides the
 * existing schedule instead of a polling loop of its own. It also
 * restores the dot after a browser restart, which clears badges.
 */
async function runHeartbeat(handler: PointsHandler): Promise<void> {
  try {
    await handler.heartbeatIfDue();
  } catch (error) {
    console.error("Gleam Points heartbeat failed:", error);
  }
  try {
    await handler.checkSeats();
  } catch (error) {
    console.error("Gleam Points seat check failed:", error);
  }
}

export const membershipsOf = (raw: unknown) => storedRecord<PointsMembership>(raw);
