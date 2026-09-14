import { browser } from "wxt/browser";
import type { WindowPort } from "@gleam/core";

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
 * Window tracking: `browser.windows.create` returns a `Windows.Window`
 * with a numeric `id`, but `WindowPort`'s `close`/`focus` methods are
 * keyed by `requestId` (a string), not a window id — so this adapter
 * keeps its own in-memory `requestId -> windowId` map, populated on
 * create and read on close/focus. This map is intentionally
 * module-level, not persisted: it only needs to survive for the lifetime
 * of a single open approval window within one service-worker lifetime: if
 * the service worker restarts while an approval window is open, the
 * window itself is still open in the browser (untracked, but not lost —
 * the user can still interact with it and it will still call
 * `resolveApproval` on completion); a stale/missing map entry only means
 * `closeApprovalWindow`/`focusApprovalWindow` silently no-op instead of
 * acting on a window this adapter no longer has an id for, which is the
 * least-bad degradation for a tracking structure that cannot be persisted
 * across restarts without also persisting OS-level window handles.
 */
const APPROVAL_WINDOW_WIDTH = 390;
const APPROVAL_WINDOW_HEIGHT = 640;

const openApprovalWindowIds = new Map<string, number>();

function extractRequestId(url: string): string | null {
  try {
    const parsed = new URL(url, browser.runtime.getURL("/"));
    return parsed.searchParams.get("requestId");
  } catch {
    return null;
  }
}

export class WxtWindowPort implements WindowPort {
  async createApprovalWindow(url: string): Promise<void> {
    const created = await browser.windows.create({
      url,
      type: "popup",
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
      focused: true,
    });

    const requestId = extractRequestId(url);
    if (requestId !== null && typeof created?.id === "number") {
      openApprovalWindowIds.set(requestId, created.id);
    }
  }

  async closeApprovalWindow(requestId: string): Promise<void> {
    const windowId = openApprovalWindowIds.get(requestId);
    if (windowId === undefined) return;
    openApprovalWindowIds.delete(requestId);
    try {
      await browser.windows.remove(windowId);
    } catch {
      // Already closed by the user — nothing left to do.
    }
  }

  async focusApprovalWindow(requestId: string): Promise<void> {
    const windowId = openApprovalWindowIds.get(requestId);
    if (windowId === undefined) return;
    try {
      await browser.windows.update(windowId, { focused: true, drawAttention: true });
    } catch {
      openApprovalWindowIds.delete(requestId);
    }
  }
}

export const windowPort: WindowPort = new WxtWindowPort();
