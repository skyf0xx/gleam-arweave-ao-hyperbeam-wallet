/**
 * The runtime worker's view of the approval sheet. It imports nothing
 * native, so the worker bundle stays free of Capacitor; the UI thread draws
 * the sheet and serves it (`serveApprovalSheet`).
 */
import * as Comlink from "comlink";
import type { ApprovalPresenterPort } from "@gleam/core";
import { exposeMethods } from "./comlink-guard";

/** The message a worker sends to ask for the sheet, carrying its ends of both channels. */
export const APPROVAL_SHEET_REQUEST = "gleam:approval-sheet";

/** What the UI thread answers: the sheet's own queue of requests. */
export interface SheetControls {
  show(requestId: string): Promise<void>;
  hide(requestId: string): Promise<void>;
}

/**
 * `ApprovalPresenterPort` for the runtime worker. Two channels, because a
 * comlink endpoint serves one direction: the worker calls the sheet on one,
 * and the sheet reports the user's dismissals on the other.
 */
export function createWorkerApprovalPresenter(scope: { postMessage(message: unknown, transfer: Transferable[]): void }): ApprovalPresenterPort {
  const controls = new MessageChannel();
  const dismissals = new MessageChannel();
  scope.postMessage({ type: APPROVAL_SHEET_REQUEST, controls: controls.port2, dismissals: dismissals.port2 }, [
    controls.port2,
    dismissals.port2,
  ]);
  const sheet = Comlink.wrap<SheetControls>(controls.port1);

  const listeners = new Set<(requestId: string) => void>();
  exposeMethods(
    {
      async dismissed(requestId: unknown) {
        if (typeof requestId !== "string") return;
        for (const listener of listeners) listener(requestId);
      },
    },
    ["dismissed"],
    dismissals.port1,
  );

  return {
    present: (requestId) => sheet.show(requestId),
    // The sheet is already in front of the user.
    focus: async () => {},
    dismiss: (requestId) => sheet.hide(requestId),
    onDismissed(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
