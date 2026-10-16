import { afterEach, describe, expect, it, vi } from "vitest";

const { setAccessLevel } = vi.hoisted(() => ({ setAccessLevel: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { storage: { session: { setAccessLevel } } } }));

import { restrictSessionStorageToTrustedContexts } from "./session-access";

describe("restrictSessionStorageToTrustedContexts", () => {
  afterEach(() => {
    setAccessLevel.mockReset();
    vi.restoreAllMocks();
  });

  it("limits session storage to the extension's own contexts", async () => {
    setAccessLevel.mockResolvedValue(undefined);
    await restrictSessionStorageToTrustedContexts();
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("never fails startup, and logs no error detail", async () => {
    setAccessLevel.mockRejectedValue(new Error("secret detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(restrictSessionStorageToTrustedContexts()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
  });
});
