import * as Comlink from "comlink";
import type { ApprovalSheetPort } from "@gleam/app/src/app-platform/types.ts";
import { APPROVAL_SHEET_REQUEST, type SheetControls } from "./approval-presenter";
import { exposeMethods } from "./comlink-guard";

export interface ApprovalSheet extends ApprovalSheetPort, SheetControls {
  /** Calls `listener` with each request the user closes the sheet on. */
  onDismissed(listener: (requestId: string) => void): () => void;
  /** Closes every request the sheet holds, as the user dismissing each. */
  dismissAll(): void;
}

/**
 * The UI thread's side of the approval sheet. One sheet shows one request;
 * requests that arrive meanwhile wait their turn, like the extension's
 * windows that each take their own, in order.
 */
export function createApprovalSheet(): ApprovalSheet {
  const queue: string[] = [];
  const shownListeners = new Set<(requestId: string | null) => void>();
  const dismissedListeners = new Set<(requestId: string) => void>();

  const notify = () => {
    for (const listener of shownListeners) listener(queue[0] ?? null);
  };
  /** Takes `requestId` out of the queue, and says whether it was there. */
  const remove = (requestId: string): boolean => {
    const index = queue.indexOf(requestId);
    if (index < 0) return false;
    queue.splice(index, 1);
    if (index === 0) notify();
    return true;
  };

  return {
    async show(requestId) {
      if (typeof requestId !== "string" || queue.includes(requestId)) return;
      queue.push(requestId);
      if (queue.length === 1) notify();
    },
    async hide(requestId) {
      remove(requestId);
    },
    subscribe(onChange) {
      shownListeners.add(onChange);
      if (queue.length > 0) onChange(queue[0] ?? null);
      return () => {
        shownListeners.delete(onChange);
      };
    },
    dismissed(requestId) {
      if (!remove(requestId)) return;
      for (const listener of dismissedListeners) listener(requestId);
    },
    dismissAll() {
      for (const requestId of [...queue]) this.dismissed(requestId);
    },
    onDismissed(listener) {
      dismissedListeners.add(listener);
      return () => {
        dismissedListeners.delete(listener);
      };
    },
  };
}

/** Answers the runtime worker's `createWorkerApprovalPresenter`. */
export function serveApprovalSheet(worker: Worker, sheet: ApprovalSheet): void {
  let served = false;
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; controls?: unknown; dismissals?: unknown } | null;
    if (served || data?.type !== APPROVAL_SHEET_REQUEST) return;
    if (!(data.controls instanceof MessagePort) || !(data.dismissals instanceof MessagePort)) return;
    served = true;
    exposeMethods<SheetControls>(sheet, ["show", "hide"], data.controls);
    const remote = Comlink.wrap<{ dismissed(requestId: string): Promise<void> }>(data.dismissals);
    sheet.onDismissed((requestId) => {
      remote.dismissed(requestId).catch(() => undefined);
    });
  });
}
