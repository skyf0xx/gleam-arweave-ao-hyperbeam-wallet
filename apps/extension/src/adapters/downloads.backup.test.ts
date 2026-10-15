import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { createDownloadPort, eraseDataDownloads, watchDownloadHistory, type DownloadPortOptions } from "./downloads";

vi.mock("wxt/browser", () => ({ browser: {} }));

type Delta = Browser.downloads.DownloadDelta;
type Item = Partial<Browser.downloads.DownloadItem>;
type DownloadsApi = NonNullable<DownloadPortOptions["downloads"]>;
type PermissionsApi = NonNullable<DownloadPortOptions["permissions"]>;

const EXTENSION_ID = "gleam-extension-id";
const KEYFILE_URL = "data:application/json;base64,eyJrdHkiOiJSU0EifQ==";

afterEach(() => {
  vi.useRealTimers();
});

function fakeDownloadsApi(options: { initial?: Item; reject?: Error; history?: Item[] } = {}) {
  const listeners = new Set<(delta: Delta) => void>();
  let item: Item = options.initial ?? { id: 42, state: "in_progress" };
  const api = {
    download: vi.fn<(options: Browser.downloads.DownloadOptions) => Promise<number>>(async () => {
      if (options.reject) throw options.reject;
      return 42;
    }),
    search: vi.fn<(query: Browser.downloads.DownloadQuery) => Promise<Browser.downloads.DownloadItem[]>>(async (query) =>
      (options.history ? options.history.filter((entry) => query.id === undefined || entry.id === query.id) : [item]) as Browser.downloads.DownloadItem[],
    ),
    erase: vi.fn<(query: Browser.downloads.DownloadQuery) => Promise<number[]>>(async () => [42]),
    onChanged: {
      addListener: (listener: (delta: Delta) => void) => listeners.add(listener),
      removeListener: (listener: (delta: Delta) => void) => listeners.delete(listener),
    },
  };
  const settle = (next: Item, id = 42) => {
    item = { ...item, ...next };
    for (const listener of listeners) {
      listener({
        id,
        state: { current: next.state },
        ...(next.error ? { error: { current: next.error } } : {}),
      } as Delta);
    }
  };
  return { api: api as unknown as DownloadsApi & typeof api, settle, listeners };
}

function fakePermissionsApi(granted: boolean) {
  const listeners = new Set<(added: Browser.permissions.Permissions) => void>();
  const api = {
    contains: vi.fn(async () => granted),
    onAdded: {
      addListener: (listener: (added: Browser.permissions.Permissions) => void) => listeners.add(listener),
      removeListener: (listener: (added: Browser.permissions.Permissions) => void) => listeners.delete(listener),
    },
  };
  const grant = (permissions: Browser.permissions.Permissions["permissions"]) => {
    for (const listener of listeners) listener({ permissions });
  };
  return { api: api as unknown as PermissionsApi, grant, listeners };
}

const FILE = {
  filename: "jade-arweave-keyfile.json",
  mimeType: "application/json",
  bytes: new TextEncoder().encode('{"kty":"RSA","n":"abc"}'),
};

describe("createDownloadPort: saveFile", () => {
  it("downloads the bytes as a data: URL under the given filename", async () => {
    const { api, settle, listeners } = fakeDownloadsApi();
    const saving = createDownloadPort({ downloads: api }).saveFile(FILE);
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    settle({ state: "complete", filename: "/home/me/Downloads/jade-arweave-keyfile (1).json" });

    await expect(saving).resolves.toEqual({ ok: true, filename: "jade-arweave-keyfile (1).json" });
    const { url, filename, saveAs } = api.download.mock.calls[0]![0];
    expect(filename).toBe(FILE.filename);
    expect(saveAs).toBeUndefined();
    const [prefix, body] = url!.split(",");
    expect(prefix).toBe("data:application/json;base64");
    expect(atob(body!)).toBe('{"kty":"RSA","n":"abc"}');
  });

  it("erases the history entry, which holds the contents in its URL", async () => {
    const { api, settle, listeners } = fakeDownloadsApi();
    const saving = createDownloadPort({ downloads: api }).saveFile(FILE);
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    settle({ state: "complete" });
    await saving;
    expect(api.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it("resolves a download that finished before the listener was attached", async () => {
    const { api, listeners } = fakeDownloadsApi({ initial: { id: 42, state: "complete", filename: "/d/x.json" } });
    await expect(createDownloadPort({ downloads: api }).saveFile(FILE)).resolves.toEqual({ ok: true, filename: "x.json" });
    expect(listeners.size).toBe(0);
  });

  it("reports a cancelled save dialog as cancelled", async () => {
    const { api, settle, listeners } = fakeDownloadsApi();
    const saving = createDownloadPort({ downloads: api }).saveFile(FILE);
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    settle({ state: "interrupted", error: "USER_CANCELED" });
    await expect(saving).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(api.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it("reports a cancel that rejects the download call as cancelled", async () => {
    const { api } = fakeDownloadsApi({ reject: new Error("Download canceled") });
    await expect(createDownloadPort({ downloads: api }).saveFile(FILE)).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("reports any other interruption as failed", async () => {
    const { api, settle, listeners } = fakeDownloadsApi();
    const saving = createDownloadPort({ downloads: api }).saveFile(FILE);
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    settle({ state: "interrupted", error: "FILE_NO_SPACE" });
    await expect(saving).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("reports a rejected download call as failed", async () => {
    const { api } = fakeDownloadsApi({ reject: new Error("Invalid filename") });
    await expect(createDownloadPort({ downloads: api }).saveFile(FILE)).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("gives up on a download that never settles, and still erases it", async () => {
    const { api, listeners } = fakeDownloadsApi();
    const saving = createDownloadPort({ downloads: api, settleTimeoutMs: 20 }).saveFile(FILE);
    await expect(saving).resolves.toEqual({ ok: false, reason: "failed" });
    expect(listeners.size).toBe(0);
    expect(api.erase).toHaveBeenCalledWith({ id: 42 });
  });
});

describe("createDownloadPort: ensureAllowed", () => {
  it("is allowed at once when the permission is already granted", async () => {
    const { api } = fakePermissionsApi(true);
    await expect(createDownloadPort({ permissions: api }).ensureAllowed()).resolves.toBe(true);
  });

  it("waits for the grant the popup asked for", async () => {
    const { api, grant, listeners } = fakePermissionsApi(false);
    const allowed = createDownloadPort({ permissions: api }).ensureAllowed();
    await vi.waitFor(() => expect(api.contains).toHaveBeenCalled());
    grant(["tabs"]);
    grant(["downloads"]);
    await expect(allowed).resolves.toBe(true);
    expect(listeners.size).toBe(0);
  });

  it("gives up when no grant arrives", async () => {
    const { api, listeners } = fakePermissionsApi(false);
    await expect(createDownloadPort({ permissions: api, permissionWaitMs: 20 }).ensureAllowed()).resolves.toBe(false);
    expect(listeners.size).toBe(0);
  });
});

describe("createDownloadPort: isAllowed and abort", () => {
  it("reports the current grant without waiting", async () => {
    await expect(createDownloadPort({ permissions: fakePermissionsApi(false).api }).isAllowed()).resolves.toBe(false);
    await expect(createDownloadPort({ permissions: fakePermissionsApi(true).api }).isAllowed()).resolves.toBe(true);
  });

  it("stops waiting for the grant when aborted", async () => {
    const { api, listeners } = fakePermissionsApi(false);
    const controller = new AbortController();
    const allowed = createDownloadPort({ permissions: api }).ensureAllowed(controller.signal);
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    controller.abort();
    await expect(allowed).resolves.toBe(false);
    expect(listeners.size).toBe(0);
  });
});

describe("download history cleanup", () => {
  const history: Item[] = [
    { id: 1, url: KEYFILE_URL, byExtensionId: EXTENSION_ID, state: "complete" },
    { id: 2, url: KEYFILE_URL, byExtensionId: EXTENSION_ID, state: "interrupted" },
    { id: 3, url: KEYFILE_URL, byExtensionId: EXTENSION_ID, state: "in_progress" },
    { id: 4, url: KEYFILE_URL, byExtensionId: "another-extension", state: "complete" },
    { id: 5, url: "https://example.com/report.json", byExtensionId: EXTENSION_ID, state: "complete" },
    { id: 6, url: KEYFILE_URL, state: "complete" },
  ];

  it("erases only this extension's settled data: downloads", async () => {
    const { api } = fakeDownloadsApi({ history });
    await eraseDataDownloads(api, EXTENSION_ID);
    expect(api.search).toHaveBeenCalledWith({ urlRegex: "^data:application/json;base64," });
    expect(api.erase.mock.calls.map(([query]) => query)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("sweeps on start and erases a keyfile download that settles later", async () => {
    const { api, settle, listeners } = fakeDownloadsApi({ history });
    const { api: permissions } = fakePermissionsApi(true);
    watchDownloadHistory(EXTENSION_ID, { downloads: api, permissions });
    expect(listeners.size).toBe(1);
    await vi.waitFor(() => expect(api.erase).toHaveBeenCalledTimes(2));

    api.erase.mockClear();
    settle({ state: "complete" }, 1);
    settle({ state: "complete" }, 4);
    await vi.waitFor(() => expect(api.erase).toHaveBeenCalledTimes(1));
    expect(api.erase).toHaveBeenCalledWith({ id: 1 });
  });

  it("starts once the downloads permission is granted later", async () => {
    const { api: permissions, grant } = fakePermissionsApi(false);
    const downloads = fakeDownloadsApi({ history });
    // `browser.downloads` only exists once the permission is granted.
    const source: { api?: DownloadsApi } = {};
    watchDownloadHistory(EXTENSION_ID, {
      get downloads() {
        return source.api;
      },
      permissions,
    });
    expect(downloads.listeners.size).toBe(0);

    source.api = downloads.api;
    grant(["downloads"]);
    grant(["downloads"]);
    expect(downloads.listeners.size).toBe(1);
  });
});
