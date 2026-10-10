import { browser } from "wxt/browser";
import {
  bytesToBase64Url,
  type BadgePort,
  signMessage,
  type InviteRedeemResult,
  type InviteUnlock,
  type JWKInterface,
  type PointsMembership,
  type PointsScores,
  type PointsSeatsRecord,
  type PointsSharePrompt,
  type StoragePort,
} from "@gleam/core";
import {
  buildDeviceMessage,
  buildLeaveMessage,
  buildRedeemMessage,
  buildRegisterMessage,
  isValidInviteCode,
  normalizeInviteCode,
  signDeviceMessage,
} from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "../adapters/device-key";

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
/** Ids of wallets whose founding reveal has been shown, as `{ [walletId]: true }`. */
export const POINTS_REVEAL_SEEN_KEY = "local:points:foundingRevealSeen";
/**
 * Ids of wallets that reached the claim step and haven't claimed or tapped
 * Not now, as `{ [walletId]: true }`. Kept in storage because the popup
 * closes on any link click, which would otherwise lose the step.
 */
export const POINTS_CLAIM_PENDING_KEY = "local:points:claimPending";
/** Named share prompts each wallet has dismissed or acted on, as `{ [walletId]: PointsSharePrompt[] }`. */
export const POINTS_SHARE_SEEN_KEY = "local:points:shareSeen";
/**
 * Per-wallet seat counts as `{ [walletId]: { seen, latest } }`. `seen` is
 * the count the member has been shown. Anything that shows a "new invite"
 * (the Points banner, the toolbar dot, the main-screen notice) compares
 * the server's count against it.
 */
export const POINTS_SEATS_SEEN_KEY = "local:points:seatsSeen";

/**
 * A wallet earns only if its install sent a heartbeat in the 3 days before
 * a snapshot (POINTS.md § Rules). One every ~20 hours keeps a margin even
 * when Chrome only runs for part of the day.
 */
const HEARTBEAT_INTERVAL_MS = 20 * 3_600_000;

export interface PointsHandlerDeps {
  storage: StoragePort;
  deviceKey: () => Promise<DeviceKey>;
  apiUrl: string;
  /** The unlocked wallet's key from the session cache, or null if it's locked. */
  signingKey: (walletId: string) => Promise<{ jwk: JWKInterface; address: string } | null>;
  badge: BadgePort;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class PointsHandler {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly deps: PointsHandlerDeps) {
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
    const stored = await this.deps.storage.get<Record<string, PointsMembership>>(POINTS_MEMBERSHIPS_KEY);
    return stored !== null && typeof stored === "object" ? stored : {};
  }

  /**
   * Registers a wallet with the points API. A hand-typed `inviteCode`
   * wins over one the site handed over. The server credits a code only on
   * an install's first wallet, so the pending code is cleared after any
   * successful join. Registering counts as a heartbeat.
   */
  async join(req: { walletId: string; inviteCode?: string }): Promise<PointsMembership> {
    const key = await this.deps.signingKey(req.walletId);
    if (!key) throw new Error("Unlock this wallet to join Gleam Points.");

    const typed = req.inviteCode?.trim() ? normalizeInviteCode(req.inviteCode) : null;
    if (typed !== null && !isValidInviteCode(typed)) throw new Error("That invite code isn't valid.");
    const pending = await this.deps.storage.get<string>(POINTS_PENDING_INVITE_KEY);
    const inviteCode = typed ?? (typeof pending === "string" && isValidInviteCode(pending) ? pending : null);

    const device = await this.deps.deviceKey();
    const message = buildRegisterMessage({
      deviceKeyThumbprint: device.id,
      inviteCode,
      issuedAt: Math.floor(this.now() / 1000),
    });
    const signature = await signMessage(key.jwk, new TextEncoder().encode(message).buffer as ArrayBuffer);
    const response = await this.fetchImpl(`${this.deps.apiUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        owner: key.jwk.n,
        message,
        signature: bytesToBase64Url(new Uint8Array(signature)),
        devicePublicKey: device.publicKey,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      address?: unknown;
      inviteCode?: unknown;
      referred?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok) {
      const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(`Couldn't join Gleam Points: ${reason}`);
    }
    if (body?.address !== key.address || typeof body.inviteCode !== "string" || typeof body.referred !== "boolean") {
      throw new Error("The points server sent an unexpected response.");
    }

    const membership: PointsMembership = {
      address: key.address,
      inviteCode: body.inviteCode,
      referred: body.referred,
      joinedAt: this.now(),
    };
    await this.deps.storage.set(POINTS_MEMBERSHIPS_KEY, { ...(await this.getMemberships()), [req.walletId]: membership });
    await this.deps.storage.set<PointsDeviceState>(POINTS_DEVICE_STATE_KEY, {
      registered: true,
      lastHeartbeatAt: this.now(),
    });
    await this.deps.storage.remove(POINTS_PENDING_INVITE_KEY);
    await this.setClaimPending({ walletId: req.walletId, pending: false });
    return membership;
  }

  async getClaimPending(): Promise<string[]> {
    const stored = await this.deps.storage.get<Record<string, true>>(POINTS_CLAIM_PENDING_KEY);
    return stored !== null && typeof stored === "object" ? Object.keys(stored) : [];
  }

  async setClaimPending(req: { walletId: string; pending: boolean }): Promise<void> {
    const stored = await this.deps.storage.get<Record<string, true>>(POINTS_CLAIM_PENDING_KEY);
    const next: Record<string, true> = { ...(stored !== null && typeof stored === "object" ? stored : {}) };
    if (req.pending) next[req.walletId] = true;
    else delete next[req.walletId];
    await this.deps.storage.set(POINTS_CLAIM_PENDING_KEY, next);
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
    if (!isValidInviteCode(code)) throw new Error("That invite code isn't valid.");
    const existing = await this.getInviteUnlock();
    if (existing?.result === "ok") return existing;

    const result = await this.requestRedeem(code);
    const unlock: InviteUnlock = { code, result, at: this.now() };
    await this.deps.storage.set(POINTS_INVITE_UNLOCK_KEY, unlock);
    // The claim step applies this code when the first wallet joins.
    if (result === "ok") await this.deps.storage.set(POINTS_PENDING_INVITE_KEY, code);
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
    await this.deps.storage.set<InviteUnlock>(POINTS_INVITE_UNLOCK_KEY, { code: "", result: "ok", at: this.now() });
  }

  /**
   * The code the claim step will apply, or null if there is none. A drop
   * code has no referrer, so it is dropped here rather than shown as a
   * code that earns anything. If the server can't say what kind of code
   * it is, the code is kept: `join` sends it and the server decides.
   */
  async pendingInvite(): Promise<string | null> {
    const pending = await this.deps.storage.get<string>(POINTS_PENDING_INVITE_KEY);
    if (typeof pending !== "string" || !isValidInviteCode(pending)) return null;
    if ((await this.inviteKind(pending)) === "drop") {
      await this.deps.storage.remove(POINTS_PENDING_INVITE_KEY);
      return null;
    }
    return pending;
  }

  async getRevealSeen(): Promise<string[]> {
    const stored = await this.deps.storage.get<Record<string, true>>(POINTS_REVEAL_SEEN_KEY);
    return stored !== null && typeof stored === "object" ? Object.keys(stored) : [];
  }

  async markRevealSeen(req: { walletId: string }): Promise<void> {
    const stored = await this.deps.storage.get<Record<string, true>>(POINTS_REVEAL_SEEN_KEY);
    await this.deps.storage.set(POINTS_REVEAL_SEEN_KEY, { ...(stored !== null && typeof stored === "object" ? stored : {}), [req.walletId]: true });
  }

  private async inviteKind(code: string): Promise<"member" | "drop" | null> {
    try {
      const response = await this.fetchImpl(`${this.deps.apiUrl}/invite/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { kind?: unknown } | null;
      return body?.kind === "member" || body?.kind === "drop" ? body.kind : null;
    } catch {
      return null;
    }
  }

  private async requestRedeem(code: string): Promise<InviteRedeemResult> {
    try {
      const device = await this.deps.deviceKey();
      const message = buildRedeemMessage(code, Math.floor(this.now() / 1000));
      const response = await this.fetchImpl(`${this.deps.apiUrl}/invite/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          message,
          signature: await signDeviceMessage(device.privateKey, message),
          devicePublicKey: device.publicKey,
        }),
      });
      if (!response.ok) return "offline";
      const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
      const result = body?.result;
      return result === "ok" || result === "full" || result === "unknown" ? result : "offline";
    } catch {
      return "offline";
    }
  }

  /**
   * Deletes the wallet's points data on the server, then forgets the
   * membership. Once no wallet on this install is a member, heartbeats
   * stop. The device key is kept: the server no longer knows it, and a
   * later join reuses it.
   */
  async leave(req: { walletId: string }): Promise<void> {
    const key = await this.deps.signingKey(req.walletId);
    if (!key) throw new Error("Unlock this wallet to leave Gleam Points.");

    const message = buildLeaveMessage(key.address, Math.floor(this.now() / 1000));
    const signature = await signMessage(key.jwk, new TextEncoder().encode(message).buffer as ArrayBuffer);
    const response = await this.fetchImpl(`${this.deps.apiUrl}/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: key.jwk.n, message, signature: bytesToBase64Url(new Uint8Array(signature)) }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(`Couldn't leave Gleam Points: ${reason}`);
    }

    const remaining = { ...(await this.getMemberships()) };
    delete remaining[req.walletId];
    await this.deps.storage.set(POINTS_MEMBERSHIPS_KEY, remaining);
    // A later rejoin is a new join: its prompts and seat count start over.
    const shareSeen = await this.readShareSeen();
    delete shareSeen[req.walletId];
    await this.deps.storage.set(POINTS_SHARE_SEEN_KEY, shareSeen);
    const seats = await this.readSeats();
    delete seats[req.walletId];
    await this.deps.storage.set(POINTS_SEATS_SEEN_KEY, seats);
    await this.updateBadge(seats);
    if (Object.keys(remaining).length === 0) {
      await this.deps.storage.set<PointsDeviceState>(POINTS_DEVICE_STATE_KEY, { registered: false, lastHeartbeatAt: null });
    }
  }

  /**
   * Reads this install's standing with a device-signed `POST /me`. Returns
   * null before any wallet has joined, since the server doesn't know the
   * device yet.
   */
  async scores(): Promise<PointsScores | null> {
    if (!(await this.loadState()).registered) return null;
    const response = await this.postDeviceSigned("me");
    if (!response.ok) throw new Error(`Couldn't load Gleam Points (HTTP ${response.status}).`);
    const body = (await response.json()) as PointsScores;
    if (!Array.isArray(body?.wallets)) throw new Error("The points server sent an unexpected response.");
    await this.syncSeats(body).catch((error: unknown) => console.error("Gleam Points seat check failed:", error));
    return body;
  }

  async getShareSeen(): Promise<Record<string, PointsSharePrompt[]>> {
    return this.readShareSeen();
  }

  async markShareSeen(req: { walletId: string; prompt: PointsSharePrompt }): Promise<void> {
    const seen = await this.readShareSeen();
    const prompts = seen[req.walletId] ?? [];
    if (!prompts.includes(req.prompt)) seen[req.walletId] = [...prompts, req.prompt];
    await this.deps.storage.set(POINTS_SHARE_SEEN_KEY, seen);
  }

  async getSeatsSeen(): Promise<Record<string, number>> {
    return Object.fromEntries(Object.entries(await this.readSeats()).map(([walletId, record]) => [walletId, record.seen]));
  }

  async markSeatsSeen(req: { walletId: string; seats: number }): Promise<void> {
    const seats = await this.readSeats();
    seats[req.walletId] = { seen: req.seats, latest: Math.max(seats[req.walletId]?.latest ?? 0, req.seats) };
    await this.deps.storage.set(POINTS_SEATS_SEEN_KEY, seats);
    await this.updateBadge(seats);
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
   * Compares the server's seat counts with what each member has been
   * shown. A wallet seen for the first time is recorded without a signal,
   * so existing members don't get a false "new invite". A lower count
   * (a seat was used) lowers `seen` too, so the seat that comes back
   * later reads as new. Wallets with no seat limit (Phase 2) are skipped.
   */
  private async syncSeats(scores: PointsScores): Promise<void> {
    const memberships = await this.getMemberships();
    const seats = await this.readSeats();
    for (const [walletId, membership] of Object.entries(memberships)) {
      const latest = scores.wallets.find((wallet) => wallet.address === membership.address)?.seatsLeft;
      if (typeof latest !== "number") continue;
      const previous = seats[walletId];
      seats[walletId] = { seen: previous === undefined ? latest : Math.min(previous.seen, latest), latest };
    }
    await this.deps.storage.set(POINTS_SEATS_SEEN_KEY, seats);
    await this.updateBadge(seats);
  }

  private async updateBadge(seats: Record<string, PointsSeatsRecord>): Promise<void> {
    await this.deps.badge.setDot(Object.values(seats).some((record) => record.latest > record.seen));
  }

  private async readShareSeen(): Promise<Record<string, PointsSharePrompt[]>> {
    const stored = await this.deps.storage.get<Record<string, PointsSharePrompt[]>>(POINTS_SHARE_SEEN_KEY);
    return stored !== null && typeof stored === "object" ? { ...stored } : {};
  }

  private async readSeats(): Promise<Record<string, PointsSeatsRecord>> {
    const stored = await this.deps.storage.get<Record<string, PointsSeatsRecord>>(POINTS_SEATS_SEEN_KEY);
    return stored !== null && typeof stored === "object" ? { ...stored } : {};
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
      await this.deps.storage.set<PointsDeviceState>(POINTS_DEVICE_STATE_KEY, { registered: false, lastHeartbeatAt: null });
      return false;
    }
    if (!response.ok) throw new Error(`Points heartbeat failed (HTTP ${response.status}).`);

    await this.deps.storage.set<PointsDeviceState>(POINTS_DEVICE_STATE_KEY, {
      registered: true,
      lastHeartbeatAt: this.now(),
    });
    return true;
  }

  private async postDeviceSigned(kind: "heartbeat" | "me"): Promise<Response> {
    const device = await this.deps.deviceKey();
    const message = buildDeviceMessage(kind, Math.floor(this.now() / 1000));
    return this.fetchImpl(`${this.deps.apiUrl}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: device.id,
        message,
        signature: await signDeviceMessage(device.privateKey, message),
      }),
    });
  }
}

const POINTS_HEARTBEAT_ALARM_NAME = "points-heartbeat";

/**
 * Checks every 6 hours, plus once whenever the service worker starts, so
 * a browser that was closed through the scheduled time still sends a
 * heartbeat soon after it opens. `heartbeatIfDue` decides whether to
 * actually send.
 *
 * The alarm is created only if missing: re-creating it on every worker
 * start would push its first firing back each time.
 */
export function registerPointsHeartbeatAlarm(handler: PointsHandler): void {
  void browser.alarms.get(POINTS_HEARTBEAT_ALARM_NAME).then((existing) => {
    if (!existing) browser.alarms.create(POINTS_HEARTBEAT_ALARM_NAME, { periodInMinutes: 6 * 60 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POINTS_HEARTBEAT_ALARM_NAME) void runHeartbeat(handler);
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
