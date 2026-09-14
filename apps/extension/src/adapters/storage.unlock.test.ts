import { describe, expect, it, vi, beforeEach } from "vitest";

const getItem = vi.fn();
const setItem = vi.fn();
const removeItem = vi.fn();
const watch = vi.fn();

vi.mock("wxt/utils/storage", () => ({
  storage: { getItem, setItem, removeItem, watch },
}));

/**
 * Untrusted-storage re-validation (per the onboarding-unlock packet's
 * rule) is owned by callers (`wallet-lifecycle.ts`), not this adapter —
 * this file only tests the adapter's own contract: area-prefix
 * validation and pass-through to `wxt/utils/storage`.
 */
describe("adapters/storage: WxtStoragePort (onboarding/unlock wiring)", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    watch.mockReset();
  });

  it("get() forwards a valid local: key to storage.getItem", async () => {
    getItem.mockResolvedValue({ wallets: [] });
    const { storagePort } = await import("./storage");

    const result = await storagePort.get("local:wallets");

    expect(getItem).toHaveBeenCalledWith("local:wallets");
    expect(result).toEqual({ wallets: [] });
  });

  it("get() forwards a valid session: key to storage.getItem", async () => {
    getItem.mockResolvedValue(null);
    const { storagePort } = await import("./storage");

    await storagePort.get("session:unlocked-session");

    expect(getItem).toHaveBeenCalledWith("session:unlocked-session");
  });

  it("set() forwards to storage.setItem", async () => {
    const { storagePort } = await import("./storage");

    await storagePort.set("local:wallets", { wallets: [1, 2] });

    expect(setItem).toHaveBeenCalledWith("local:wallets", { wallets: [1, 2] });
  });

  it("remove() forwards to storage.removeItem", async () => {
    const { storagePort } = await import("./storage");

    await storagePort.remove("local:wallets");

    expect(removeItem).toHaveBeenCalledWith("local:wallets");
  });

  it("watch() forwards to storage.watch and returns the unsubscribe function", async () => {
    const unsubscribe = vi.fn();
    watch.mockReturnValue(unsubscribe);
    const { storagePort } = await import("./storage");
    const cb = vi.fn();

    const result = storagePort.watch("local:wallets", cb);

    expect(watch).toHaveBeenCalledWith("local:wallets", expect.any(Function));
    const registeredCb = watch.mock.calls[0]![1] as (v: unknown) => void;
    registeredCb("new-value");
    expect(cb).toHaveBeenCalledWith("new-value");
    expect(result).toBe(unsubscribe);
  });

  it("rejects a key with no valid storage-area prefix", async () => {
    const { storagePort } = await import("./storage");

    await expect(storagePort.get("wallets")).rejects.toThrow(/invalid storage key/i);
  });

  it("rejects a key with an unrecognized storage-area prefix", async () => {
    const { storagePort } = await import("./storage");

    await expect(storagePort.get("bogus:wallets")).rejects.toThrow(/invalid storage key/i);
  });
});
