import { describe, expect, it, vi, beforeEach } from "vitest";

const sendMessage = vi.fn();
const onMessage = vi.fn();
const defineExtensionMessaging = vi.fn(() => ({ sendMessage, onMessage }));

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging,
}));

/**
 * `runtime.ts` calls `defineExtensionMessaging` once at module scope, so
 * the mock must be registered before the dynamic import in each test —
 * this file exercises the adapter's translation between `RuntimePort`'s
 * generic `RuntimeMessage`/`onMessage(type, handler)` shape and
 * `@webext-core/messaging`'s per-`ProtocolMap`-method calls (onboarding/
 * unlock naming per the task packet's filter).
 */
describe("adapters/runtime: WebextCoreRuntimePort (onboarding/unlock wiring)", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMessage.mockReset();
    onMessage.mockReset();
  });

  it("send() forwards the message type and payload to sendMessage", async () => {
    sendMessage.mockResolvedValue({ unlockedWalletIds: ["wallet-1"] });
    const { runtimePort } = await import("./runtime");

    const result = await runtimePort.send<{ password: string }, { unlockedWalletIds: string[] }>(
      { type: "unlockWallet", payload: { password: "correct horse battery staple" } },
    );

    expect(sendMessage).toHaveBeenCalledWith("unlockWallet", {
      password: "correct horse battery staple",
    });
    expect(result).toEqual({ unlockedWalletIds: ["wallet-1"] });
  });

  it("onMessage() registers a handler that unwraps message.data before calling through", async () => {
    const { runtimePort } = await import("./runtime");
    const handler = vi.fn().mockResolvedValue({ unlockedWalletIds: [] });

    runtimePort.onMessage("unlockWallet", handler);

    expect(onMessage).toHaveBeenCalledWith("unlockWallet", expect.any(Function));
    const registered = onMessage.mock.calls[0]![1] as (message: unknown) => unknown;
    await registered({ data: { password: "x" }, type: "unlockWallet", id: 1, timestamp: 0 });

    expect(handler).toHaveBeenCalledWith({ password: "x" });
  });

  it("onMessage() returns the unsubscribe function from the underlying messenger", async () => {
    const unsubscribe = vi.fn();
    onMessage.mockReturnValue(unsubscribe);
    const { runtimePort } = await import("./runtime");

    const result = runtimePort.onMessage("lockWallet", vi.fn());

    expect(result).toBe(unsubscribe);
  });
});
