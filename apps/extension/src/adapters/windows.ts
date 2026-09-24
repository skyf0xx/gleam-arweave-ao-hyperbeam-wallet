import { browser } from "wxt/browser";
import type { StoragePort, WindowPort } from "@gleam/core";
import { storagePort } from "./storage";

/**
 * Implements `WindowPort` over `browser.windows.*` (WXT's cross-browser
 * `webextension-polyfill`-shaped API surface) — the only place
 * `browser.windows` is reached in this repo, per the same hexagonal
 * boundary `storage.ts`/`runtime.ts` already follow. `core` never imports
 * this file; it only sees `WindowPort`.
 *
 * ARCHITECTURE.md §3.2: every approval window opens as its own
 * `type: "popup"` window, ~390x640, focused — never inline in the
 * extension popup, since a popup closes on focus loss and would silently
 * drop the pending request.
 *
 * Window tracking: `WindowPort` is keyed by `requestId`, but
 * `browser.windows` by numeric window id. The `requestId -> windowId` map
 * lives in `session:approvalWindows`, so a service worker that restarts
 * while an approval window is open can still close, focus, or notice the
 * user closing that window. Every read-modify-write of the map runs on one
 * promise chain, so concurrent creates and closes can't drop each other's
 * entries.
 */
const APPROVAL_WINDOW_WIDTH = 390;
const APPROVAL_WINDOW_HEIGHT = 640;
const APPROVAL_WINDOWS_KEY = "session:approvalWindows";

type ApprovalWindowMap = Record<string, number>;

function extractRequestId(url: string): string | null {
  try {
    const parsed = new URL(url, browser.runtime.getURL("/"));
    return parsed.searchParams.get("requestId");
  } catch {
    return null;
  }
}

function isApprovalWindowMap(value: unknown): value is ApprovalWindowMap {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((windowId) => typeof windowId === "number")
  );
}

export class WxtWindowPort implements WindowPort {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly closedListeners = new Set<(requestId: string) => void>();
  private listeningForRemovals = false;

  constructor(private readonly storage: StoragePort = storagePort) {}

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async loadMap(): Promise<ApprovalWindowMap> {
    const raw = await this.storage.get<unknown>(APPROVAL_WINDOWS_KEY);
    return isApprovalWindowMap(raw) ? raw : {};
  }

  /** Removes `requestId` from the map and returns its window id, if it had one. */
  private untrack(requestId: string): Promise<number | undefined> {
    return this.serialize(async () => {
      const map = await this.loadMap();
      const windowId = map[requestId];
      if (windowId === undefined) return undefined;
      delete map[requestId];
      await this.storage.set(APPROVAL_WINDOWS_KEY, map);
      return windowId;
    });
  }

  async createApprovalWindow(url: string): Promise<void> {
    const created = await browser.windows.create({
      url,
      type: "popup",
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
      focused: true,
    });

    const requestId = extractRequestId(url);
    const windowId = created?.id;
    if (requestId === null || typeof windowId !== "number") return;
    await this.serialize(async () => {
      const map = await this.loadMap();
      map[requestId] = windowId;
      await this.storage.set(APPROVAL_WINDOWS_KEY, map);
    });
  }

  async closeApprovalWindow(requestId: string): Promise<void> {
    // Untracked first, so the `onRemoved` this causes isn't reported as
    // the user closing the window.
    const windowId = await this.untrack(requestId);
    if (windowId === undefined) return;
    try {
      await browser.windows.remove(windowId);
    } catch {
      // Already closed by the user — nothing left to do.
    }
  }

  async focusApprovalWindow(requestId: string): Promise<void> {
    const windowId = (await this.loadMap())[requestId];
    if (windowId === undefined) return;
    try {
      await browser.windows.update(windowId, { focused: true, drawAttention: true });
    } catch {
      await this.untrack(requestId);
    }
  }

  /**
   * Call this synchronously at service-worker startup: MV3 only delivers
   * the `onRemoved` event that wakes a stopped worker to listeners added
   * in its first turn.
   */
  onApprovalWindowClosed(listener: (requestId: string) => void): () => void {
    this.closedListeners.add(listener);
    if (!this.listeningForRemovals) {
      this.listeningForRemovals = true;
      browser.windows.onRemoved.addListener((windowId) => {
        void this.handleWindowRemoved(windowId);
      });
    }
    return () => {
      this.closedListeners.delete(listener);
    };
  }

  private async handleWindowRemoved(windowId: number): Promise<void> {
    const requestId = await this.serialize(async () => {
      const map = await this.loadMap();
      const match = Object.entries(map).find(([, id]) => id === windowId)?.[0];
      if (match === undefined) return undefined;
      delete map[match];
      await this.storage.set(APPROVAL_WINDOWS_KEY, map);
      return match;
    });
    if (requestId === undefined) return;
    for (const listener of this.closedListeners) listener(requestId);
  }
}

export const windowPort: WindowPort = new WxtWindowPort();
