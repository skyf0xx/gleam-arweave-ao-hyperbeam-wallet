import { describe, expect, it, vi } from "vitest";
import type { ApprovalPresenterPort } from "@gleam/core";

export interface ApprovalPresenterHarness {
  port: ApprovalPresenterPort;
  /** The user closing the approval UI for `requestId` themselves. */
  userDismiss(requestId: string): Promise<void>;
  /** Whether the UI for `requestId` is on screen. */
  isShowing(requestId: string): Promise<boolean>;
  cleanup?: () => void | Promise<void>;
}

/** Lets a dismissal the adapter reports asynchronously arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

export function describeApprovalPresenterPort(
  name: string,
  makeHarness: () => Promise<ApprovalPresenterHarness>,
): void {
  describe(`ApprovalPresenterPort conformance: ${name}`, () => {
    async function withHarness(test: (harness: ApprovalPresenterHarness) => Promise<void>): Promise<void> {
      const harness = await makeHarness();
      try {
        await test(harness);
      } finally {
        await harness.cleanup?.();
      }
    }

    it("shows the UI for a presented request", () =>
      withHarness(async ({ port, isShowing }) => {
        await port.present("r1");

        await expect(isShowing("r1")).resolves.toBe(true);
        await expect(isShowing("r2")).resolves.toBe(false);
      }));

    it("reports the user closing the UI once, with the request id", () =>
      withHarness(async ({ port, userDismiss, isShowing }) => {
        const dismissed = vi.fn();
        port.onDismissed(dismissed);
        await port.present("r1");

        await userDismiss("r1");
        await vi.waitFor(() => expect(dismissed).toHaveBeenCalledWith("r1"));
        await userDismiss("r1");
        await settle();

        expect(dismissed).toHaveBeenCalledTimes(1);
        await expect(isShowing("r1")).resolves.toBe(false);
      }));

    it("takes the UI down on dismiss without reporting it", () =>
      withHarness(async ({ port, userDismiss, isShowing }) => {
        const dismissed = vi.fn();
        port.onDismissed(dismissed);
        await port.present("r1");

        await port.dismiss("r1");
        await userDismiss("r1");
        await settle();

        await expect(isShowing("r1")).resolves.toBe(false);
        expect(dismissed).not.toHaveBeenCalled();
      }));

    it("treats dismiss and focus of an unknown request as no-ops", () =>
      withHarness(async ({ port }) => {
        const dismissed = vi.fn();
        port.onDismissed(dismissed);

        await expect(port.focus("unknown")).resolves.toBeUndefined();
        await expect(port.dismiss("unknown")).resolves.toBeUndefined();
        await settle();

        expect(dismissed).not.toHaveBeenCalled();
      }));

    it("keeps the UI showing after focus", () =>
      withHarness(async ({ port, isShowing }) => {
        await port.present("r1");

        await port.focus("r1");

        await expect(isShowing("r1")).resolves.toBe(true);
      }));

    it("tracks two requests independently", () =>
      withHarness(async ({ port, userDismiss, isShowing }) => {
        const dismissed = vi.fn();
        port.onDismissed(dismissed);
        await port.present("r1");
        await port.present("r2");

        await userDismiss("r1");
        await vi.waitFor(() => expect(dismissed).toHaveBeenCalledWith("r1"));
        await expect(isShowing("r2")).resolves.toBe(true);

        await port.dismiss("r2");
        await settle();

        expect(dismissed).toHaveBeenCalledTimes(1);
        await expect(isShowing("r2")).resolves.toBe(false);
      }));

    it("calls every listener", () =>
      withHarness(async ({ port, userDismiss }) => {
        const first = vi.fn();
        const second = vi.fn();
        port.onDismissed(first);
        port.onDismissed(second);
        await port.present("r1");

        await userDismiss("r1");

        await vi.waitFor(() => {
          expect(first).toHaveBeenCalledWith("r1");
          expect(second).toHaveBeenCalledWith("r1");
        });
      }));

    it("stops calling a listener once it unsubscribes", () =>
      withHarness(async ({ port, userDismiss }) => {
        const kept = vi.fn();
        const dropped = vi.fn();
        port.onDismissed(kept);
        const unsubscribe = port.onDismissed(dropped);
        unsubscribe();
        await port.present("r1");

        await userDismiss("r1");

        await vi.waitFor(() => expect(kept).toHaveBeenCalledWith("r1"));
        expect(dropped).not.toHaveBeenCalled();
      }));
  });
}
