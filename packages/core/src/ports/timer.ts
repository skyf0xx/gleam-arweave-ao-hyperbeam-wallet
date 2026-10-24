/**
 * Runs a callback on a fixed period, keyed by a name. Implemented by
 * `apps/extension/src/adapters/timer.ts` over `browser.alarms`; `core` and
 * the handlers only see this interface.
 */
export interface TimerPort {
  /**
   * Calls `run` every `periodMinutes`. Call it synchronously while the
   * background script loads: an implementation may need the listener
   * registered by then to receive ticks that wake a suspended worker.
   *
   * Idempotent per `name`: repeating the call on every start must not
   * push back the next tick of a schedule that already exists.
   */
  every(name: string, periodMinutes: number, run: () => void): void;
}
