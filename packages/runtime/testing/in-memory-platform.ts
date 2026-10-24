import type {
  ApprovalPresenterPort,
  DeviceKeyPort,
  DownloadPort,
  FileDownloadResult,
  StoragePort,
  TimerPort,
} from "@gleam/core";
import { Keyring } from "@gleam/core/signer";
import type { LockIndicatorPort, Platform, TabPush, TabsPort } from "../src/platform";
import type { SiteTab } from "../src/handlers/site-wallet";

/**
 * Values are cloned in and out, as `chrome.storage` serializes them, so a
 * test can't pass by sharing an object with the code under test.
 */
export class InMemoryStorage implements StoragePort {
  /** The stored values, for a test to read or seed directly. */
  readonly entries = new Map<string, unknown>();
  private readonly watchers = new Map<string, Set<(value: unknown) => void>>();

  async get<T>(key: string): Promise<T | null> {
    return this.entries.has(key) ? (structuredClone(this.entries.get(key)) as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, structuredClone(value));
    this.notify(key, value);
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(entries);
    const areas = new Set(keys.map((key) => key.slice(0, key.indexOf(":"))));
    if (areas.size > 1) {
      throw new Error(`setMany keys must share one storage area, got ${[...areas].join(", ")}.`);
    }
    const nullish = Object.keys(entries).find((key) => entries[key] == null);
    if (nullish !== undefined) {
      throw new Error(`setMany value for "${nullish}" is null or undefined; use remove to delete a key.`);
    }
    for (const key of keys) this.entries.set(key, structuredClone(entries[key]));
    // Notify only after every entry is in place so no watcher sees a partial write.
    for (const key of keys) this.notify(key, entries[key]);
  }

  async remove(key: string): Promise<void> {
    if (!this.entries.delete(key)) return;
    this.notify(key, null);
  }

  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    const listeners = this.watchers.get(key) ?? new Set();
    const listener = cb as (value: unknown) => void;
    listeners.add(listener);
    this.watchers.set(key, listeners);
    return () => void listeners.delete(listener);
  }

  private notify(key: string, value: unknown): void {
    for (const listener of this.watchers.get(key) ?? []) listener(structuredClone(value));
  }
}

export interface TimerSchedule {
  periodMinutes: number;
  /** When the schedule was first created; a repeated `every` must not move it. */
  scheduledTime: number;
}

/** Runs nothing by itself: a test advances a schedule with `fire`. */
export class InMemoryTimer implements TimerPort {
  private readonly schedules = new Map<string, TimerSchedule>();
  private readonly listeners = new Map<string, Array<() => void>>();

  every(name: string, periodMinutes: number, run: () => void): void {
    if (!this.schedules.has(name)) this.schedules.set(name, { periodMinutes, scheduledTime: Date.now() });
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), run]);
  }

  /** One tick of the schedule `name`. */
  fire(name: string): void {
    for (const run of this.listeners.get(name) ?? []) run();
  }

  schedule(name: string): TimerSchedule | undefined {
    return this.schedules.get(name);
  }
}

/** Tracks which requests are showing; `userDismiss` plays the user closing one. */
export class InMemoryApprovalPresenter implements ApprovalPresenterPort {
  private readonly showing = new Set<string>();
  private readonly listeners = new Set<(requestId: string) => void>();
  readonly focused: string[] = [];

  async present(requestId: string): Promise<void> {
    this.showing.add(requestId);
  }

  async focus(requestId: string): Promise<void> {
    if (this.showing.has(requestId)) this.focused.push(requestId);
  }

  async dismiss(requestId: string): Promise<void> {
    this.showing.delete(requestId);
  }

  onDismissed(listener: (requestId: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  isShowing(requestId: string): boolean {
    return this.showing.has(requestId);
  }

  async userDismiss(requestId: string): Promise<void> {
    if (!this.showing.delete(requestId)) return;
    for (const listener of this.listeners) listener(requestId);
  }
}

export class InMemoryTabs implements TabsPort {
  /** What `webTabs` and `activeTab` report; a test sets these. */
  tabs: SiteTab[] = [];
  active: SiteTab | undefined;
  readonly reloaded: number[] = [];
  readonly sent: Array<{ tabId: number; type: TabPush; data: unknown }> = [];

  async webTabs(): Promise<SiteTab[]> {
    return this.tabs;
  }

  async activeTab(): Promise<SiteTab | undefined> {
    return this.active;
  }

  async reload(tabId: number): Promise<void> {
    this.reloaded.push(tabId);
  }

  async send(tabId: number, type: TabPush, data: unknown): Promise<void> {
    this.sent.push({ tabId, type, data });
  }
}

export class InMemoryDownloads implements DownloadPort {
  readonly saved: Array<{ filename: string; mimeType: string; bytes: Uint8Array }> = [];

  async isAllowed(): Promise<boolean> {
    return true;
  }

  async ensureAllowed(): Promise<boolean> {
    return true;
  }

  async saveFile(file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<FileDownloadResult> {
    this.saved.push(file);
    return { ok: true, filename: file.filename };
  }
}

export interface InMemoryPlatform extends Platform {
  storage: InMemoryStorage;
  sessionKeys: Keyring;
  approvalPresenter: InMemoryApprovalPresenter;
  timer: InMemoryTimer;
  tabs: InMemoryTabs;
  downloads: InMemoryDownloads;
  /** Every dot state `badge.setDot` was given, in order. */
  badgeDots: boolean[];
  /** Every state `lockIndicator.setLocked` was given, in order. */
  lockStates: boolean[];
}

const noDeviceKey: DeviceKeyPort = {
  loadOrCreate: () => Promise.reject(new Error("The in-memory platform has no device key; pass `deviceKey`.")),
};

/**
 * A `Platform` that touches nothing outside memory, for tests of the
 * runtime. `overrides` replaces any port, e.g. `deviceKey` for a points test.
 */
export function createInMemoryPlatform(overrides: Partial<Platform> = {}): InMemoryPlatform {
  const badgeDots: boolean[] = [];
  const lockStates: boolean[] = [];
  const lockIndicator: LockIndicatorPort = {
    setLocked: async (locked) => void lockStates.push(locked),
  };
  return {
    storage: new InMemoryStorage(),
    sessionKeys: new Keyring(),
    approvalPresenter: new InMemoryApprovalPresenter(),
    timer: new InMemoryTimer(),
    deviceKey: noDeviceKey,
    badge: { setDot: async (visible) => void badgeDots.push(visible) },
    lockIndicator,
    downloads: new InMemoryDownloads(),
    tabs: new InMemoryTabs(),
    version: () => "0.0.0-test",
    dev: true,
    ...overrides,
    badgeDots,
    lockStates,
  } as InMemoryPlatform;
}
