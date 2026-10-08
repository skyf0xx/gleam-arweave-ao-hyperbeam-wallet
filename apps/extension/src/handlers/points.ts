import { browser } from "wxt/browser";
import type { StoragePort } from "@gleam/core";
import { buildDeviceMessage, signDeviceMessage } from "@gleam/core/src/points/index.ts";
import type { DeviceKey } from "../adapters/device-key";

/** Per-install Gleam Points state. `registered` flips once any wallet registers. */
export interface PointsDeviceState {
  registered: boolean;
  lastHeartbeatAt: number | null;
}

export const POINTS_DEVICE_STATE_KEY = "local:points:device";

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

    const device = await this.deps.deviceKey();
    const message = buildDeviceMessage("heartbeat", Math.floor(this.now() / 1000));
    const response = await this.fetchImpl(`${this.deps.apiUrl}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: device.id,
        message,
        signature: await signDeviceMessage(device.privateKey, message),
      }),
    });

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
