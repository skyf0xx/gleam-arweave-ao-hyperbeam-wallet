import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTimerPort } from "@gleam/runtime/testing/index.ts";
import { WorkerTimer } from "./timer";

/** A timer whose intervals a test ticks by hand, by name. */
function manualTimer() {
  const ticks = new Map<string, () => void>();
  const periods: number[] = [];
  const timer = new WorkerTimer((tick, periodMs, name) => {
    ticks.set(name, tick);
    periods.push(periodMs);
  });
  return { timer, ticks, periods };
}

describeTimerPort("WorkerTimer", async () => {
  const { timer, ticks } = manualTimer();
  return {
    port: timer,
    fire: async (name) => ticks.get(name)?.(),
    schedule: async (name) => timer.schedule(name),
  };
});

describe("WorkerTimer", () => {
  afterEach(() => vi.useRealTimers());

  it("starts one interval per name, at its period", () => {
    const { timer, periods } = manualTimer();
    timer.every("a", 1, () => {});
    timer.every("a", 1, () => {});
    timer.every("b", 5, () => {});

    expect(periods).toEqual([60_000, 300_000]);
  });

  it("on catching up, runs only the schedules whose period went by", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { timer } = manualTimer();
    const minute = vi.fn();
    const hour = vi.fn();
    timer.every("minute", 1, minute);
    timer.every("hour", 60, hour);

    vi.setSystemTime(Date.now() + 30_000);
    timer.catchUp();
    expect(minute).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 10 * 60_000);
    timer.catchUp();
    timer.catchUp();
    expect(minute).toHaveBeenCalledTimes(1);
    expect(hour).not.toHaveBeenCalled();
  });

  it("keeps ticking the other callbacks when one throws", () => {
    const { timer, ticks } = manualTimer();
    const after = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    timer.every("a", 1, () => {
      throw new Error("bug");
    });
    timer.every("a", 1, after);

    ticks.get("a")?.();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
