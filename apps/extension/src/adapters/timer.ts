import { browser } from "wxt/browser";
import type { TimerPort } from "@gleam/core";

/**
 * Implements `TimerPort` over `browser.alarms`. The listener is added
 * synchronously because MV3 only delivers an alarm that woke the worker to
 * listeners registered during its first turn. The alarm is created only if
 * missing, since re-creating it on every worker start would restart its
 * period each time.
 */
export const alarmTimer: TimerPort = {
  every(name, periodMinutes, run) {
    void browser.alarms.get(name).then((existing) => {
      if (!existing) browser.alarms.create(name, { periodInMinutes: periodMinutes });
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === name) run();
    });
  },
};
