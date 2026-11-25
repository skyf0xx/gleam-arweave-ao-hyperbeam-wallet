import { describe, expect, it, vi } from "vitest";
import { createOverlayGuard, type OverlayGuardPlugin } from "./overlay-guard";

function fakePlugin() {
  const listeners = new Set<() => void>();
  const plugin = {
    setGuarded: vi.fn(async () => {}),
    addListener: vi.fn(async (_event: "touchBlocked", listener: () => void) => {
      listeners.add(listener);
      return { remove: async () => void listeners.delete(listener) };
    }),
  } satisfies OverlayGuardPlugin;
  return { plugin, blockTouch: () => listeners.forEach((listener) => listener()) };
}

describe("createOverlayGuard", () => {
  it("sends only changes to the plugin", () => {
    const { plugin } = fakePlugin();
    const guard = createOverlayGuard(plugin);

    guard.setGuarded(false);
    guard.setGuarded(true);
    guard.setGuarded(true);
    guard.setGuarded(false);

    expect(plugin.setGuarded.mock.calls).toEqual([[{ guarded: true }], [{ guarded: false }]]);
  });

  it("reports blocked taps until unsubscribed", async () => {
    const { plugin, blockTouch } = fakePlugin();
    const guard = createOverlayGuard(plugin);
    const listener = vi.fn();

    const unsubscribe = guard.onTouchBlocked(listener);
    await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
    blockTouch();
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    blockTouch();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
