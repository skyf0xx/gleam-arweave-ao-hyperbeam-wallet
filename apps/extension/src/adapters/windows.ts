import { browser } from "wxt/browser";
import type { ApprovalPresenterPort, StoragePort } from "@gleam/core";

/**
 * Implements `ApprovalPresenterPort` with one `browser.windows` popup per
 * request (the `approval` entrypoint, ~390x640, focused). The user
 * closing that window is the dismissal `onDismissed` reports.
 *
 * Window tracking: the port is keyed by `requestId`, but
 * `browser.windows` by numeric window id. The `requestId -> windowId` map
 * lives in `session:approvalWindows`, so a service worker that restarts
 * while an approval window is open can still close, focus, or notice the
 * user closing that window. Every read-modify-write of the map runs on one
 * promise chain, so concurrent creates and closes can't drop each other's
 * entries.
 */
const APPROVAL_WINDOW_PATH = "/approval.html";
const APPROVAL_WINDOW_WIDTH = 390;
const APPROVAL_WINDOW_HEIGHT = 640;
const APPROVAL_WINDOWS_KEY = "session:approvalWindows";

type ApprovalWindowMap = Record<string, number>;

function isApprovalWindowMap(value: unknown): value is ApprovalWindowMap {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((windowId) => typeof windowId === "number")
  );
}

export class WindowApprovalPresenter implements ApprovalPresenterPort {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly dismissedListeners = new Set<(requestId: string) => void>();
  private listeningForRemovals = false;

  constructor(private readonly storage: StoragePort) {}

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

  async present(requestId: string): Promise<void> {
    const created = await browser.windows.create({
      url: `${APPROVAL_WINDOW_PATH}?requestId=${encodeURIComponent(requestId)}`,
      type: "popup",
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
      focused: true,
    });

    const windowId = created?.id;
    if (typeof windowId !== "number") return;
    await this.serialize(async () => {
      const map = await this.loadMap();
      map[requestId] = windowId;
      await this.storage.set(APPROVAL_WINDOWS_KEY, map);
    });
  }

  async dismiss(requestId: string): Promise<void> {
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

  async focus(requestId: string): Promise<void> {
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
  onDismissed(listener: (requestId: string) => void): () => void {
    this.dismissedListeners.add(listener);
    if (!this.listeningForRemovals) {
      this.listeningForRemovals = true;
      browser.windows.onRemoved.addListener((windowId) => {
        void this.handleWindowRemoved(windowId);
      });
    }
    return () => {
      this.dismissedListeners.delete(listener);
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
    for (const listener of this.dismissedListeners) listener(requestId);
  }
}
