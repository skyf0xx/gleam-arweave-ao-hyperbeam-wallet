import { browser } from "wxt/browser";
import {
  bytesToBase64Url,
  signMessage,
  type JWKInterface,
  type PointsMembership,
  type PointsScores,
  type StoragePort,
} from "@gleam/core";
import {
  buildDeviceMessage,
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
    return membership;
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
    return body;
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

async function runHeartbeat(handler: PointsHandler): Promise<void> {
  try {
    await handler.heartbeatIfDue();
  } catch (error) {
    console.error("Gleam Points heartbeat failed:", error);
  }
}
