import * as Comlink from "comlink";
import type { DownloadPort } from "@gleam/core";
import { SAVER_REQUEST, type FileSaver } from "./download-channel";

/**
 * `DownloadPort` for the runtime worker: the file goes to the UI thread,
 * which opens the share sheet. There is no permission to ask the phone for.
 */
export function createWorkerDownloads(scope: { postMessage(message: unknown, transfer: Transferable[]): void }): DownloadPort {
  const channel = new MessageChannel();
  scope.postMessage({ type: SAVER_REQUEST, port: channel.port2 }, [channel.port2]);
  const saver = Comlink.wrap<FileSaver>(channel.port1);
  return {
    isAllowed: async () => true,
    ensureAllowed: async () => true,
    async saveFile({ filename, mimeType, bytes }) {
      // The caller keeps its own bytes; the copy moves to the page, which
      // zeroes it once the file is written.
      const copy = bytes.slice();
      try {
        return await saver.save(Comlink.transfer({ filename, mimeType, bytes: copy }, [copy.buffer]));
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  };
}
