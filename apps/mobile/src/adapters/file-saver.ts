import * as Comlink from "comlink";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { FileDownloadResult } from "@gleam/core";
import { SAVER_REQUEST, type FileSaver } from "./download-channel";

/** The parts of the two plugins this saver uses. */
export interface SaverPlugins {
  writeFile(options: { path: string; data: string; directory: Directory; recursive: boolean }): Promise<{ uri: string }>;
  rmdir(options: { path: string; directory: Directory; recursive: boolean }): Promise<void>;
  readdir(options: { path: string; directory: Directory }): Promise<{ files: { name: string }[] }>;
  share(options: { files: string[] }): Promise<unknown>;
}

// Both platforms reject with this exact message when the user closes the
// sheet without choosing a target (SharePlugin.swift, SharePlugin.java).
const FOLDER_PREFIX = "gleam-export-";

// Folders this page session has made, which a sweep must not delete under a save.
const live = new Set<string>();

const SHARE_CANCELLED = "Share canceled";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Writes the file to the app's cache (never backed up), shares it, and
 * deletes it once the sheet closes. The file sits in its own folder so the
 * share sheet shows the name the runtime chose without a clash.
 */
export function createFileSaver(plugins: SaverPlugins): FileSaver {
  return {
    async save({ filename, bytes }): Promise<FileDownloadResult> {
      const folder = `${FOLDER_PREFIX}${crypto.randomUUID()}`;
      live.add(folder);
      const directory = Directory.Cache;
      try {
        const { uri } = await plugins.writeFile({
          path: `${folder}/${filename.replace(/[\\/]/g, "_")}`,
          data: toBase64(bytes),
          directory,
          recursive: true,
        });
        await plugins.share({ files: [uri] });
        return { ok: true, filename };
      } catch (error) {
        const cancelled = error instanceof Error && error.message === SHARE_CANCELLED;
        return { ok: false, reason: cancelled ? "cancelled" : "failed" };
      } finally {
        bytes.fill(0);
        await plugins.rmdir({ path: folder, directory, recursive: true }).catch(() => {});
        live.delete(folder);
      }
    },
  };
}

/**
 * Removes export folders an earlier run left in the cache, such as when the
 * app was killed while the share sheet was open. Errors are ignored.
 */
export async function sweepExports(plugins: SaverPlugins): Promise<void> {
  try {
    const { files } = await plugins.readdir({ path: "", directory: Directory.Cache });
    await Promise.all(
      files
        .filter(({ name }) => name.startsWith(FOLDER_PREFIX) && !live.has(name))
        .map(({ name }) =>
          plugins.rmdir({ path: name, directory: Directory.Cache, recursive: true }).catch(() => {}),
        ),
    );
  } catch {
    // Nothing to sweep, or the cache can't be read.
  }
}

const capacitorPlugins: SaverPlugins = {
  writeFile: (options) => Filesystem.writeFile(options),
  rmdir: (options) => Filesystem.rmdir(options),
  readdir: (options) => Filesystem.readdir(options),
  share: (options) => Share.share(options),
};

/** Sweeps leftovers with the real plugins. */
export function sweepCapacitorExports(): Promise<void> {
  return sweepExports(capacitorPlugins);
}

/** The saver on the real plugins. */
export function createCapacitorFileSaver(): FileSaver {
  return createFileSaver(capacitorPlugins);
}

/**
 * Serves `saver` to the worker on the channel it opens in
 * `createWorkerDownloads`. Only the first request is served.
 */
export function serveFileSaver(worker: Worker, saver: FileSaver): void {
  let served = false;
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; port?: unknown } | null;
    if (served || data?.type !== SAVER_REQUEST || !(data.port instanceof MessagePort)) return;
    served = true;
    Comlink.expose(saver, data.port);
  });
}
