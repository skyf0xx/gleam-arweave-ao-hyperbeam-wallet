import type { TimerPort } from "@gleam/core";

interface Schedule {
  periodMs: number;
  /** When the schedule was first created; a repeated `every` must not move it. */
  scheduledTime: number;
  lastRun: number;
  runs: Array<() => void>;
}

type StartInterval = (tick: () => void, periodMs: number, name: string) => void;

/**
 * `TimerPort` over `setInterval` in the runtime worker. The OS suspends the
 * app's JavaScript in the background, so intervals stop with it; `catchUp`
 * runs, once, every schedule whose period went by meanwhile. Auto-lock
 * measures from the last activity, so time spent in the background counts.
 */
export class WorkerTimer implements TimerPort {
  private readonly schedules = new Map<string, Schedule>();

  constructor(private readonly startInterval: StartInterval = (tick, periodMs) => void setInterval(tick, periodMs)) {}

  every(name: string, periodMinutes: number, run: () => void): void {
    const existing = this.schedules.get(name);
    if (existing) {
      existing.runs.push(run);
      return;
    }
    const now = Date.now();
    const periodMs = periodMinutes * 60_000;
    this.schedules.set(name, { periodMs, scheduledTime: now, lastRun: now, runs: [run] });
    this.startInterval(() => this.tick(name), periodMs, name);
  }

  /** Runs each schedule that is overdue, as after the app comes back from the background. */
  catchUp(): void {
    const now = Date.now();
    for (const [name, schedule] of this.schedules) {
      if (now - schedule.lastRun >= schedule.periodMs) this.tick(name);
    }
  }

  schedule(name: string): { periodMinutes: number; scheduledTime: number } | undefined {
    const schedule = this.schedules.get(name);
    return schedule && { periodMinutes: schedule.periodMs / 60_000, scheduledTime: schedule.scheduledTime };
  }

  private tick(name: string): void {
    const schedule = this.schedules.get(name);
    if (!schedule) return;
    schedule.lastRun = Date.now();
    for (const run of schedule.runs) {
      try {
        run();
      } catch (error) {
        console.error(`The "${name}" timer failed.`, error);
      }
    }
  }
}
