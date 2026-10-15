import { browser, type Browser } from "wxt/browser";
import { bytesToBase64, type DownloadPort, type FileDownloadResult } from "@gleam/core";

type DownloadsApi = Pick<typeof Browser.downloads, "download" | "search" | "erase" | "onChanged">;
type PermissionsApi = Pick<typeof Browser.permissions, "contains" | "onAdded">;

export const DOWNLOADS_PERMISSION = "downloads";

/**
 * Every file this adapter saves goes out as a `data:` URL with this
 * prefix. Chrome keeps a download's URL in its history, so for a keyfile
 * the history row holds the key itself and has to be erased.
 */
const DATA_URL_PREFIX = "data:application/json;base64,";

const PERMISSION_WAIT_MS = 60_000;
const SETTLE_TIMEOUT_MS = 120_000;

export interface DownloadPortOptions {
  downloads?: DownloadsApi;
  permissions?: PermissionsApi;
  permissionWaitMs?: number;
  settleTimeoutMs?: number;
}

/**
 * Implements `DownloadPort` over `browser.downloads`.
 *
 * `downloads` is an optional permission, granted by the popup's
 * `permissions.request` on the Download click. Chrome closes the action
 * popup when that prompt opens, so the popup sends its request first and
 * `ensureAllowed` waits here for the grant.
 *
 * A service worker has no `URL.createObjectURL`, so the bytes go out as a
 * `data:` URL. The history row is erased once the download settles;
 * `watchDownloadHistory` catches the rows a stopped worker left behind.
 * Erasing removes the history row only, never the file.
 *
 * `saveAs` is left unset, so Chrome's own "ask where to save" setting
 * decides whether a dialog opens, the same as for a page's `<a download>`.
 */
export function createDownloadPort(options: DownloadPortOptions = {}): DownloadPort {
  const permissionWaitMs = options.permissionWaitMs ?? PERMISSION_WAIT_MS;
  const settleTimeoutMs = options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;
  return {
    async isAllowed() {
      const permissions = options.permissions ?? browser.permissions;
      return permissions.contains({ permissions: [DOWNLOADS_PERMISSION] }).catch(() => false);
    },

    async ensureAllowed(signal) {
      const permissions = options.permissions ?? browser.permissions;
      if (signal?.aborted) return false;
      return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (allowed: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          permissions.onAdded.removeListener(onAdded);
          signal?.removeEventListener("abort", onAbort);
          resolve(allowed);
        };
        const onAbort = () => finish(false);
        signal?.addEventListener("abort", onAbort);
        const onAdded = (added: Browser.permissions.Permissions) => {
          if (added.permissions?.includes(DOWNLOADS_PERMISSION)) finish(true);
        };
        const timer = setTimeout(() => finish(false), permissionWaitMs);
        permissions.onAdded.addListener(onAdded);
        void permissions.contains({ permissions: [DOWNLOADS_PERMISSION] }).then(
          (allowed) => {
            if (allowed) finish(true);
          },
          () => {},
        );
      });
    },

    async saveFile({ filename, mimeType, bytes }) {
      const api = options.downloads ?? browser.downloads;
      let id: number;
      try {
        id = await api.download({
          url: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
          filename,
          conflictAction: "uniquify",
        });
      } catch (error) {
        // Chrome rejects with "Download canceled" when the user dismisses
        // the save dialog before the download is created.
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: /cancel/i.test(message) ? "cancelled" : "failed" };
      }
      const result = await settled(api, id, filename, settleTimeoutMs);
      await api.erase({ id }).catch(() => {});
      return result;
    },
  };
}

function settled(api: DownloadsApi, id: number, filename: string, timeoutMs: number): Promise<FileDownloadResult> {
  return new Promise((resolve) => {
    let done = false;
    const end = (result: FileDownloadResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      api.onChanged.removeListener(listener);
      resolve(result);
    };
    const finish = (state: string | undefined, error: string | undefined, path: string | undefined) => {
      if (state === "complete") end({ ok: true, filename: basename(path) ?? filename });
      else if (state === "interrupted") end({ ok: false, reason: error === "USER_CANCELED" ? "cancelled" : "failed" });
    };
    const listener = (delta: Browser.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state) return;
      void api.search({ id }).then(
        ([item]) => finish(delta.state?.current, item?.error ?? delta.error?.current, item?.filename),
        () => finish(delta.state?.current, delta.error?.current, undefined),
      );
    };
    // A save dialog left open can keep a download pending indefinitely.
    const timer = setTimeout(() => end({ ok: false, reason: "failed" }), timeoutMs);
    api.onChanged.addListener(listener);
    // A data: URL can finish before the listener above is attached.
    void api.search({ id }).then(
      ([item]) => finish(item?.state, item?.error, item?.filename),
      () => {},
    );
  });
}

function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.split(/[\\/]/).pop() || undefined;
}

function isOwnSettledDataDownload(item: Browser.downloads.DownloadItem, extensionId: string): boolean {
  return (
    item.byExtensionId === extensionId &&
    item.url.startsWith(DATA_URL_PREFIX) &&
    item.state !== "in_progress"
  );
}

/** Erases every settled `data:` download this extension started. */
export async function eraseDataDownloads(api: DownloadsApi, extensionId: string): Promise<void> {
  const items = await api.search({ urlRegex: "^data:application/json;base64," }).catch(() => []);
  await Promise.all(
    items
      .filter((item) => isOwnSettledDataDownload(item, extensionId))
      .map((item) => api.erase({ id: item.id }).catch(() => [])),
  );
}

/**
 * Must run at the service worker's top level: Chrome wakes a stopped
 * worker for `downloads.onChanged` only when the listener is registered
 * synchronously on startup. That covers a worker stopped mid-download,
 * which never reached `saveFile`'s own erase. The startup sweep covers
 * one stopped before the download even settled.
 *
 * `browser.downloads` is undefined until the optional permission is
 * granted, so the watch also starts on `permissions.onAdded`.
 */
export function watchDownloadHistory(
  extensionId: string,
  apis: { downloads?: DownloadsApi; permissions?: PermissionsApi } = {},
): void {
  let watching = false;
  const start = () => {
    const downloads = apis.downloads ?? browser.downloads;
    if (watching || !downloads) return;
    watching = true;
    downloads.onChanged.addListener((delta) => {
      const state = delta.state?.current;
      if (state !== "complete" && state !== "interrupted") return;
      void downloads.search({ id: delta.id }).then(
        (items) =>
          Promise.all(
            items
              .filter((item) => isOwnSettledDataDownload(item, extensionId))
              .map((item) => downloads.erase({ id: item.id }).catch(() => [])),
          ),
        () => {},
      );
    });
    void eraseDataDownloads(downloads, extensionId);
  };
  start();
  (apis.permissions ?? browser.permissions)?.onAdded.addListener((added) => {
    if (added.permissions?.includes(DOWNLOADS_PERMISSION)) start();
  });
}

export const browserDownloads: DownloadPort = createDownloadPort();
