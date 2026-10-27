import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PointsLinkOutcome } from "../worker/points-link";

const listeners = vi.hoisted(() => new Map<string, (data: { url: string }) => void>());
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((event: string, listener: (data: { url: string }) => void) => {
      listeners.set(event, listener);
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

import { listenForAppLinks } from "./app-links";

beforeEach(() => listeners.clear());

describe("listenForAppLinks", () => {
  it("hands the worker each opened link exactly as it arrived", async () => {
    const openLink = vi.fn(async (): Promise<PointsLinkOutcome> => "dropped");
    listenForAppLinks(openLink, vi.fn());

    listeners.get("appUrlOpen")!({ url: "https://open.gleamwallet.app/invite?code=GLEAM42&x=%00" });
    expect(openLink).toHaveBeenCalledExactlyOnceWith("https://open.gleamwallet.app/invite?code=GLEAM42&x=%00");
  });

  it.each<[PointsLinkOutcome, number]>([
    ["gate", 1],
    ["invite", 0],
    ["attest", 0],
    ["held", 0],
    ["dropped", 0],
  ])("after %s, refreshes the gate %i times", async (outcome, times) => {
    const onGate = vi.fn();
    listenForAppLinks(async () => outcome, onGate);

    listeners.get("appUrlOpen")!({ url: "https://open.gleamwallet.app/invite?code=GLEAM42" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onGate).toHaveBeenCalledTimes(times);
  });

  it("logs a failure instead of leaving it unhandled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onGate = vi.fn();
    listenForAppLinks(async () => {
      throw new Error("worker gone");
    }, onGate);

    listeners.get("appUrlOpen")!({ url: "https://open.gleamwallet.app/invite?code=GLEAM42" });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(onGate).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
