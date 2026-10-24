import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn<(name: string) => Promise<unknown>>();
const create = vi.fn();
const addListener = vi.fn<(listener: (alarm: { name: string }) => void) => void>();

vi.mock("wxt/browser", () => ({ browser: { alarms: { get, create, onAlarm: { addListener } } } }));

const { alarmTimer } = await import("./timer");

beforeEach(() => {
  get.mockReset();
  create.mockReset();
  addListener.mockReset();
});

describe("alarmTimer", () => {
  it("registers the listener synchronously and creates a missing alarm", async () => {
    get.mockResolvedValue(undefined);
    alarmTimer.every("tick", 5, vi.fn());

    expect(addListener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith("tick", { periodInMinutes: 5 }));
  });

  it("keeps an existing alarm instead of restarting its period", async () => {
    get.mockResolvedValue({ name: "tick", periodInMinutes: 5 });
    alarmTimer.every("tick", 5, vi.fn());

    await vi.waitFor(() => expect(get).toHaveBeenCalledWith("tick"));
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
  });

  it("runs the callback only for its own alarm name", () => {
    get.mockResolvedValue(undefined);
    const run = vi.fn();
    alarmTimer.every("tick", 5, run);
    const listener = addListener.mock.calls[0]![0];

    listener({ name: "other" });
    expect(run).not.toHaveBeenCalled();
    listener({ name: "tick" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
