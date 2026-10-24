import { describe, expect, it, vi } from "vitest";
import type { TimerPort } from "@gleam/core";

export interface TimerHarness {
  port: TimerPort;
  /** Delivers one tick of the schedule `name`, as the platform's clock would. */
  fire(name: string): Promise<void>;
  /** The schedule `name` has, once the adapter has made it. */
  schedule(name: string): Promise<{ periodMinutes: number; scheduledTime: number } | undefined>;
  cleanup?: () => void | Promise<void>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function describeTimerPort(name: string, makeHarness: () => Promise<TimerHarness>): void {
  describe(`TimerPort conformance: ${name}`, () => {
    async function withHarness(test: (harness: TimerHarness) => Promise<void>): Promise<void> {
      const harness = await makeHarness();
      try {
        await test(harness);
      } finally {
        await harness.cleanup?.();
      }
    }

    it("runs the callback on each tick of its name", () =>
      withHarness(async ({ port, fire }) => {
        const run = vi.fn();
        port.every("tick", 5, run);

        await fire("tick");
        await fire("tick");

        expect(run).toHaveBeenCalledTimes(2);
      }));

    it("is listening as soon as every returns", () =>
      withHarness(async ({ port, fire }) => {
        const run = vi.fn();
        port.every("tick", 5, run);
        // No await between: a tick that wakes a suspended worker arrives in its first turn.
        const fired = fire("tick");

        await fired;
        expect(run).toHaveBeenCalledTimes(1);
      }));

    it("leaves other names' callbacks alone", () =>
      withHarness(async ({ port, fire }) => {
        const a = vi.fn();
        const b = vi.fn();
        port.every("a", 1, a);
        port.every("b", 2, b);

        await fire("a");
        await fire("unregistered");

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).not.toHaveBeenCalled();
      }));

    it("schedules the period it was given", () =>
      withHarness(async ({ port, schedule }) => {
        port.every("tick", 7, vi.fn());

        await vi.waitFor(async () => expect(await schedule("tick")).toMatchObject({ periodMinutes: 7 }));
      }));

    it("keeps the schedule it already has when every is repeated", () =>
      withHarness(async ({ port, schedule }) => {
        port.every("tick", 5, vi.fn());
        await vi.waitFor(async () => expect(await schedule("tick")).toBeDefined());
        const first = await schedule("tick");

        await wait(15);
        port.every("tick", 5, vi.fn());
        await wait(15);

        expect(await schedule("tick")).toEqual(first);
      }));
  });
}
