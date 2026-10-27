import { beforeEach, describe, expect, it, vi } from "vitest";

const requestReview = vi.hoisted(() => vi.fn());
const registerPlugin = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({ registerPlugin }));

import { createStoreReview } from "./store-review";

beforeEach(() => {
  requestReview.mockReset().mockResolvedValue(undefined);
  registerPlugin.mockReset().mockReturnValue({ requestReview });
});

describe("createStoreReview", () => {
  it("asks the OS prompt through the native plugin and opens no page", async () => {
    const port = createStoreReview();
    await port.request();
    expect(registerPlugin).toHaveBeenCalledWith("InAppReview");
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(port.opensPage).toBe(false);
  });

  it("passes a plugin failure to the caller", async () => {
    requestReview.mockRejectedValue(new Error("unavailable"));
    await expect(createStoreReview().request()).rejects.toThrow("unavailable");
  });
});
