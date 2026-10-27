import { describe, expect, it, vi } from "vitest";
import type { RuntimePort, WalletState } from "@gleam/core";
import { guardLock } from "./lock-guard";

function state(unlocked: string[] | null): WalletState {
  return {
    wallets: [{ id: "w1" }],
    activeWalletId: "w1",
    session: unlocked === null ? null : { unlockedWalletIds: unlocked },
  } as unknown as WalletState;
}

function guarded(getState: WalletState) {
  const order: string[] = [];
  const send = vi.fn(async (message: { type: string }) => {
    order.push(`send:${message.type}`);
    return message.type === "getState" ? getState : undefined;
  });
  const runtime = { send, onMessage: () => () => {}, resume: async () => {} } as unknown as RuntimePort & { resume(): Promise<void> };
  const onLocked = vi.fn(() => void order.push("locked"));
  return { port: guardLock(runtime, onLocked), onLocked, order };
}

describe("guardLock", () => {
  it("clears the page before a lock or reset reaches the runtime", async () => {
    for (const type of ["lockWallet", "resetAllWallets"]) {
      const { port, order } = guarded(state(["w1"]));
      await port.send({ type, payload: undefined });
      expect(order).toEqual(["locked", `send:${type}`]);
    }
  });

  it("runs the reset hook, not the lock one, on a wallet reset", async () => {
    const onReset = vi.fn();
    const onLocked = vi.fn();
    const runtime = { send: vi.fn(async () => undefined), onMessage: () => () => {} } as unknown as RuntimePort;
    await guardLock(runtime, onLocked, onReset).send({ type: "resetAllWallets", payload: undefined });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onLocked).not.toHaveBeenCalled();
  });

  it("clears the page when a state read finds the session gone, before returning it", async () => {
    const { port, onLocked } = guarded(state(null));
    await port.send({ type: "getState", payload: undefined });
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("also clears it when no wallet is unlocked", async () => {
    const { port, onLocked } = guarded(state([]));
    await port.send({ type: "getState", payload: undefined });
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("leaves an unlocked session and other calls alone", async () => {
    const { port, onLocked } = guarded(state(["w1"]));
    await port.send({ type: "getState", payload: undefined });
    await port.send({ type: "getBalance", payload: { address: "a" } });
    expect(onLocked).not.toHaveBeenCalled();
  });

  it("keeps the rest of the port", () => {
    const { port } = guarded(state(["w1"]));
    expect(typeof (port as unknown as { resume: unknown }).resume).toBe("function");
  });
});
