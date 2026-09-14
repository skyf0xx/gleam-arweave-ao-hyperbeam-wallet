import { describe, expect, it, vi, beforeEach } from "vitest";

const create = vi.fn();
const remove = vi.fn();
const update = vi.fn();
const getURL = vi.fn((path: string) => `chrome-extension://test-id${path}`);

vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create, remove, update },
    runtime: { getURL },
  },
}));

/**
 * `WxtWindowPort` over `browser.windows.*` (ARCHITECTURE.md §3.2): every
 * approval window opens as its own `type: "popup"` window at the
 * documented size, and close/focus are keyed by `requestId`, resolved
 * against the adapter's own internal id map populated on create.
 */
describe("adapters/windows: WxtWindowPort", () => {
  beforeEach(() => {
    create.mockReset();
    remove.mockReset();
    update.mockReset();
    getURL.mockClear();
  });

  it("createApprovalWindow opens a popup window at the documented size, focused", async () => {
    create.mockResolvedValue({ id: 42 });
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await port.createApprovalWindow("/approval.html?requestId=abc-123");

    expect(create).toHaveBeenCalledWith({
      url: "/approval.html?requestId=abc-123",
      type: "popup",
      width: 390,
      height: 640,
      focused: true,
    });
  });

  it("closeApprovalWindow removes the window created for that requestId", async () => {
    create.mockResolvedValue({ id: 7 });
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await port.createApprovalWindow("/approval.html?requestId=req-1");
    await port.closeApprovalWindow("req-1");

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("closeApprovalWindow is a no-op for an unknown requestId", async () => {
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await expect(port.closeApprovalWindow("never-opened")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("focusApprovalWindow focuses and draws attention to the tracked window", async () => {
    create.mockResolvedValue({ id: 9 });
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await port.createApprovalWindow("/approval.html?requestId=req-2");
    await port.focusApprovalWindow("req-2");

    expect(update).toHaveBeenCalledWith(9, { focused: true, drawAttention: true });
  });

  it("focusApprovalWindow is a no-op for an unknown requestId", async () => {
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await expect(port.focusApprovalWindow("never-opened")).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("closing a window twice only calls remove once", async () => {
    create.mockResolvedValue({ id: 11 });
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await port.createApprovalWindow("/approval.html?requestId=req-3");
    await port.closeApprovalWindow("req-3");
    await port.closeApprovalWindow("req-3");

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("tolerates browser.windows.remove rejecting (already closed by the user)", async () => {
    create.mockResolvedValue({ id: 13 });
    remove.mockRejectedValue(new Error("No window with id: 13."));
    const { WxtWindowPort } = await import("./windows");
    const port = new WxtWindowPort();

    await port.createApprovalWindow("/approval.html?requestId=req-4");
    await expect(port.closeApprovalWindow("req-4")).resolves.toBeUndefined();
  });
});
