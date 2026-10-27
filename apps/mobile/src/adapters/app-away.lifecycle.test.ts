import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => new Map<string, (data?: unknown) => void>());
const getPlatform = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((event: string, listener: (data?: unknown) => void) => {
      listeners.set(event, listener);
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform } }));

import { onAppAway } from "./app-away";

beforeEach(() => listeners.clear());

describe("onAppAway", () => {
  it("on Android, fires when the activity stops, not when a permission dialog pauses it", () => {
    getPlatform.mockReturnValue("android");
    const away = vi.fn();
    onAppAway(away);
    expect(listeners.has("pause")).toBe(false);

    listeners.get("appStateChange")!({ isActive: true });
    expect(away).not.toHaveBeenCalled();
    listeners.get("appStateChange")!({ isActive: false });
    expect(away).toHaveBeenCalledTimes(1);
  });

  it("on iOS, fires when the app enters the background", () => {
    getPlatform.mockReturnValue("ios");
    const away = vi.fn();
    onAppAway(away);
    expect(listeners.has("appStateChange")).toBe(false);

    listeners.get("pause")!();
    expect(away).toHaveBeenCalledTimes(1);
  });
});
