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
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
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
  const { WindowApprovalPresenter } = await import("./windows");
  return new WindowApprovalPresenter(session);
}

function userClosesWindow(windowId: number) {
  for (const listener of removedListeners) listener(windowId);
}

/**
 * `WindowApprovalPresenter` over `browser.windows.*`: every request opens
 * as its own `type: "popup"` window at the documented size, and
 * dismiss/focus are keyed by `requestId`, resolved against the adapter's
 * own id map populated on present.
 */
describe("adapters/windows: WindowApprovalPresenter", () => {
  beforeEach(() => {
    create.mockReset();
    remove.mockReset();
    update.mockReset();
    getURL.mockClear();
    onRemoved.addListener.mockClear();
    removedListeners.length = 0;
    session = createSessionStorage();
  });

  it("present opens the approval page for that requestId in a popup window at the documented size, focused", async () => {
    create.mockResolvedValue({ id: 42 });
    const port = await makePort();

    await port.present("abc 1&x=2");

    expect(create).toHaveBeenCalledWith({
      url: "/approval.html?requestId=abc%201%26x%3D2",
      type: "popup",
      width: 390,
      height: 640,
      focused: true,
    });
  });

  it("dismiss removes the window created for that requestId", async () => {
    create.mockResolvedValue({ id: 7 });
    const port = await makePort();

    await port.present("req-1");
    await port.dismiss("req-1");

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("dismiss is a no-op for an unknown requestId", async () => {
    const port = await makePort();

    await expect(port.dismiss("never-opened")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("focus focuses and draws attention to the tracked window", async () => {
    create.mockResolvedValue({ id: 9 });
    const port = await makePort();

    await port.present("req-2");
    await port.focus("req-2");

    expect(update).toHaveBeenCalledWith(9, { focused: true, drawAttention: true });
  });

  it("focus is a no-op for an unknown requestId", async () => {
    const port = await makePort();

    await expect(port.focus("never-opened")).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("closing a window twice only calls remove once", async () => {
    create.mockResolvedValue({ id: 11 });
    const port = await makePort();

    await port.present("req-3");
    await port.dismiss("req-3");
    await port.dismiss("req-3");

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("tolerates browser.windows.remove rejecting (already closed by the user)", async () => {
    create.mockResolvedValue({ id: 13 });
    remove.mockRejectedValue(new Error("No window with id: 13."));
    const port = await makePort();

    await port.present("req-4");
    await expect(port.dismiss("req-4")).resolves.toBeUndefined();
  });

  it("keeps the requestId -> windowId map in session storage, so a restarted worker can still close the window", async () => {
    create.mockResolvedValue({ id: 21 });
    await (await makePort()).present("req-5");
    expect(session.store.get("session:approvalWindows")).toEqual({ "req-5": 21 });

    const restarted = await makePort();
    await restarted.dismiss("req-5");

    expect(remove).toHaveBeenCalledWith(21);
    expect(session.store.get("session:approvalWindows")).toEqual({});
  });

  it("concurrent creates both end up in the map", async () => {
    create.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
    const port = await makePort();

    await Promise.all([
      port.present("a"),
      port.present("b"),
    ]);

    expect(session.store.get("session:approvalWindows")).toEqual({ a: 1, b: 2 });
  });

  it("reports the requestId when the user closes a tracked approval window", async () => {
    create.mockResolvedValue({ id: 31 });
    const port = await makePort();
    const closed: string[] = [];
    port.onDismissed((requestId) => closed.push(requestId));
    await port.present("req-6");

    userClosesWindow(31);

    await vi.waitFor(() => expect(closed).toEqual(["req-6"]));
    expect(session.store.get("session:approvalWindows")).toEqual({});
  });

  it("reports a window opened before a service-worker restart", async () => {
    create.mockResolvedValue({ id: 41 });
    await (await makePort()).present("req-7");

    removedListeners.length = 0;
    const restarted = await makePort();
    const closed: string[] = [];
    restarted.onDismissed((requestId) => closed.push(requestId));
    userClosesWindow(41);

    await vi.waitFor(() => expect(closed).toEqual(["req-7"]));
  });

  it("does not report a window it closed itself, or one it never opened", async () => {
    create.mockResolvedValue({ id: 51 });
    const port = await makePort();
    const closed: string[] = [];
    port.onDismissed((requestId) => closed.push(requestId));
    await port.present("req-8");

    await port.dismiss("req-8");
    userClosesWindow(51);
    userClosesWindow(999);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closed).toEqual([]);
  });

  it("adds a single onRemoved listener however many subscribers there are", async () => {
    const port = await makePort();
    const unsubscribe = port.onDismissed(() => {});
    port.onDismissed(() => {});
    unsubscribe();

    expect(onRemoved.addListener).toHaveBeenCalledTimes(1);
  });

  it("untracks a window that can no longer be focused", async () => {
    create.mockResolvedValue({ id: 61 });
    update.mockRejectedValue(new Error("No window with id: 61."));
    const port = await makePort();

    await port.present("req-9");
    await port.focus("req-9");

    expect(session.store.get("session:approvalWindows")).toEqual({});
  });

  it("dismiss after the user closed the window does not touch the browser", async () => {
    create.mockResolvedValue({ id: 71 });
    const port = await makePort();
    const dismissed: string[] = [];
    port.onDismissed((requestId) => dismissed.push(requestId));
    await port.present("req-10");

    userClosesWindow(71);
    await vi.waitFor(() => expect(dismissed).toEqual(["req-10"]));
    await port.dismiss("req-10");

    expect(remove).not.toHaveBeenCalled();
  });

  it("reports each user-closed window once, to every subscriber, and only for its own requestId", async () => {
    create.mockResolvedValueOnce({ id: 81 }).mockResolvedValueOnce({ id: 82 });
    const port = await makePort();
    const first: string[] = [];
    const second: string[] = [];
    port.onDismissed((requestId) => first.push(requestId));
    port.onDismissed((requestId) => second.push(requestId));
    await port.present("req-11");
    await port.present("req-12");

    userClosesWindow(82);
    userClosesWindow(82);

    await vi.waitFor(() => expect(first).toEqual(["req-12"]));
    expect(second).toEqual(["req-12"]);
    expect(session.store.get("session:approvalWindows")).toEqual({ "req-11": 81 });
  });

  it("stops reporting to an unsubscribed listener", async () => {
    create.mockResolvedValue({ id: 91 });
    const port = await makePort();
    const dismissed: string[] = [];
    const unsubscribe = port.onDismissed((requestId) => dismissed.push(requestId));
    await port.present("req-13");

    unsubscribe();
    userClosesWindow(91);
    await vi.waitFor(() => expect(session.store.get("session:approvalWindows")).toEqual({}));

    expect(dismissed).toEqual([]);
  });
});
