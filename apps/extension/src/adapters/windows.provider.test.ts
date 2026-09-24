import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StoragePort } from "@gleam/core";

const create = vi.fn();
const remove = vi.fn();
const update = vi.fn();
const removedListeners: Array<(windowId: number) => void> = [];
const onRemoved = { addListener: vi.fn((listener: (windowId: number) => void) => removedListeners.push(listener)) };
const getURL = vi.fn((path: string) => `chrome-extension://test-id${path}`);

vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create, remove, update, onRemoved },
    runtime: { getURL },
  },
}));

vi.mock("./storage", () => ({ storagePort: null }));

/** Stands in for `chrome.storage.session`, which outlives a service-worker restart. */
function createSessionStorage(): StoragePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string) {
      return store.has(key) ? (JSON.parse(JSON.stringify(store.get(key))) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

let session: ReturnType<typeof createSessionStorage>;

async function makePort() {
  const { WxtWindowPort } = await import("./windows");
  return new WxtWindowPort(session);
}

function userClosesWindow(windowId: number) {
  for (const listener of removedListeners) listener(windowId);
}

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
    onRemoved.addListener.mockClear();
    removedListeners.length = 0;
    session = createSessionStorage();
  });

  it("createApprovalWindow opens a popup window at the documented size, focused", async () => {
    create.mockResolvedValue({ id: 42 });
    const port = await makePort();

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
    const port = await makePort();

    await port.createApprovalWindow("/approval.html?requestId=req-1");
    await port.closeApprovalWindow("req-1");

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("closeApprovalWindow is a no-op for an unknown requestId", async () => {
    const port = await makePort();

    await expect(port.closeApprovalWindow("never-opened")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("focusApprovalWindow focuses and draws attention to the tracked window", async () => {
    create.mockResolvedValue({ id: 9 });
    const port = await makePort();

    await port.createApprovalWindow("/approval.html?requestId=req-2");
    await port.focusApprovalWindow("req-2");

    expect(update).toHaveBeenCalledWith(9, { focused: true, drawAttention: true });
  });

  it("focusApprovalWindow is a no-op for an unknown requestId", async () => {
    const port = await makePort();

    await expect(port.focusApprovalWindow("never-opened")).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("closing a window twice only calls remove once", async () => {
    create.mockResolvedValue({ id: 11 });
    const port = await makePort();

    await port.createApprovalWindow("/approval.html?requestId=req-3");
    await port.closeApprovalWindow("req-3");
    await port.closeApprovalWindow("req-3");

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("tolerates browser.windows.remove rejecting (already closed by the user)", async () => {
    create.mockResolvedValue({ id: 13 });
    remove.mockRejectedValue(new Error("No window with id: 13."));
    const port = await makePort();

    await port.createApprovalWindow("/approval.html?requestId=req-4");
    await expect(port.closeApprovalWindow("req-4")).resolves.toBeUndefined();
  });

  it("keeps the requestId -> windowId map in session storage, so a restarted worker can still close the window", async () => {
    create.mockResolvedValue({ id: 21 });
    await (await makePort()).createApprovalWindow("/approval.html?requestId=req-5");
    expect(session.store.get("session:approvalWindows")).toEqual({ "req-5": 21 });

    const restarted = await makePort();
    await restarted.closeApprovalWindow("req-5");

    expect(remove).toHaveBeenCalledWith(21);
    expect(session.store.get("session:approvalWindows")).toEqual({});
  });

  it("concurrent creates both end up in the map", async () => {
    create.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
    const port = await makePort();

    await Promise.all([
      port.createApprovalWindow("/approval.html?requestId=a"),
      port.createApprovalWindow("/approval.html?requestId=b"),
    ]);

    expect(session.store.get("session:approvalWindows")).toEqual({ a: 1, b: 2 });
  });

  it("reports the requestId when the user closes a tracked approval window", async () => {
    create.mockResolvedValue({ id: 31 });
    const port = await makePort();
    const closed: string[] = [];
    port.onApprovalWindowClosed((requestId) => closed.push(requestId));
    await port.createApprovalWindow("/approval.html?requestId=req-6");

    userClosesWindow(31);

    await vi.waitFor(() => expect(closed).toEqual(["req-6"]));
    expect(session.store.get("session:approvalWindows")).toEqual({});
  });

  it("reports a window opened before a service-worker restart", async () => {
    create.mockResolvedValue({ id: 41 });
    await (await makePort()).createApprovalWindow("/approval.html?requestId=req-7");

    removedListeners.length = 0;
    const restarted = await makePort();
    const closed: string[] = [];
    restarted.onApprovalWindowClosed((requestId) => closed.push(requestId));
    userClosesWindow(41);

    await vi.waitFor(() => expect(closed).toEqual(["req-7"]));
  });

  it("does not report a window it closed itself, or one it never opened", async () => {
    create.mockResolvedValue({ id: 51 });
    const port = await makePort();
    const closed: string[] = [];
    port.onApprovalWindowClosed((requestId) => closed.push(requestId));
    await port.createApprovalWindow("/approval.html?requestId=req-8");

    await port.closeApprovalWindow("req-8");
    userClosesWindow(51);
    userClosesWindow(999);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closed).toEqual([]);
  });

  it("adds a single onRemoved listener however many subscribers there are", async () => {
    const port = await makePort();
    const unsubscribe = port.onApprovalWindowClosed(() => {});
    port.onApprovalWindowClosed(() => {});
    unsubscribe();

    expect(onRemoved.addListener).toHaveBeenCalledTimes(1);
  });
});
