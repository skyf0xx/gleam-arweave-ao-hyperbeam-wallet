// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { describeApprovalPresenterPort } from "@gleam/runtime/testing/index.ts";
import { createApprovalSheet, serveApprovalSheet, type ApprovalSheet } from "./approval-sheet";
import { createWorkerApprovalPresenter } from "./approval-presenter";

/** The worker's presenter and the UI thread's sheet, joined by real channels as the app joins them. */
function wired() {
  const worker = new EventTarget();
  const sheet = createApprovalSheet();
  serveApprovalSheet(worker as Worker, sheet);
  const ports: MessagePort[] = [];
  const presenter = createWorkerApprovalPresenter({
    postMessage(message, transfer) {
      ports.push(...(transfer as MessagePort[]));
      worker.dispatchEvent(new MessageEvent("message", { data: message }));
    },
  });
  let shown: string | null = null;
  sheet.subscribe((requestId) => {
    shown = requestId;
  });
  return { sheet, presenter, shown: () => shown, close: () => ports.forEach((port) => port.close()) };
}

describeApprovalPresenterPort("approval sheet", async () => {
  const { sheet, presenter, shown, close } = wired();
  return {
    port: presenter,
    userDismiss: async (requestId) => sheet.dismissed(requestId),
    isShowing: async (requestId) => shown() === requestId,
    cleanup: close,
  };
});

describe("approval sheet", () => {
  async function presented(sheet: ApprovalSheet, ...requestIds: string[]) {
    for (const requestId of requestIds) await sheet.show(requestId);
  }

  it("shows one request at a time and brings up the next when it closes", async () => {
    const sheet = createApprovalSheet();
    const seen: Array<string | null> = [];
    sheet.subscribe((requestId) => seen.push(requestId));

    await presented(sheet, "r1", "r2");
    expect(seen).toEqual(["r1"]);

    await sheet.hide("r1");
    await sheet.hide("r2");
    expect(seen).toEqual(["r1", "r2", null]);
  });

  it("tells a late subscriber what is showing", async () => {
    const sheet = createApprovalSheet();
    await presented(sheet, "r1");
    const seen = vi.fn();

    sheet.subscribe(seen);

    expect(seen).toHaveBeenCalledWith("r1");
  });

  it("reports every request it holds as dismissed when told to close all", async () => {
    const sheet = createApprovalSheet();
    const dismissed = vi.fn();
    sheet.onDismissed(dismissed);
    await presented(sheet, "r1", "r2");

    sheet.dismissAll();

    expect(dismissed.mock.calls).toEqual([["r1"], ["r2"]]);
  });

  it("ignores a request it isn't showing", async () => {
    const sheet = createApprovalSheet();
    const dismissed = vi.fn();
    sheet.onDismissed(dismissed);

    sheet.dismissed("unknown");

    expect(dismissed).not.toHaveBeenCalled();
  });
});
