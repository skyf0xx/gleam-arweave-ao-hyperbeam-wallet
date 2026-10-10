import { beforeEach, describe, expect, it, vi } from "vitest";

const setBadgeText = vi.fn(async () => {});
const setBadgeBackgroundColor = vi.fn(async () => {});
vi.mock("wxt/browser", () => ({ browser: { action: { setBadgeText, setBadgeBackgroundColor } } }));

const { actionBadge } = await import("./badge");

beforeEach(() => vi.clearAllMocks());

describe("actionBadge", () => {
  it("shows a dot on the toolbar icon", async () => {
    await actionBadge.setDot(true);

    expect(setBadgeText).toHaveBeenCalledWith({ text: "•" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#8b12ff" });
  });

  it("clears it", async () => {
    await actionBadge.setDot(false);

    expect(setBadgeText).toHaveBeenCalledWith({ text: "" });
  });
});
