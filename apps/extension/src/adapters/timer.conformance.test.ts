import { fakeBrowser } from "./fake-browser.testing";
import { describeTimerPort } from "@gleam/runtime/testing/index.ts";
import { alarmTimer } from "./timer";

describeTimerPort("alarmTimer", async () => ({
  port: alarmTimer,
  fire: async (name) => {
    await fakeBrowser.alarms.onAlarm.trigger({ name, scheduledTime: Date.now(), persistAcrossSessions: false });
  },
  schedule: async (name) => {
    const alarm = await fakeBrowser.alarms.get(name);
    return alarm?.periodInMinutes === undefined
      ? undefined
      : { periodMinutes: alarm.periodInMinutes, scheduledTime: alarm.scheduledTime };
  },
  cleanup: () => fakeBrowser.reset(),
}));
