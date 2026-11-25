import * as Comlink from "comlink";
import type { BackupProvider } from "@gleam/core/src/models/backup.ts";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import type { CloudFilePort } from "@gleam/core/src/ports/cloud-file.ts";
import { requestChannel, type WorkerScope } from "./comlink-guard";
import { CLOUD_FILE_REQUEST, type CloudFileHost } from "./cloud-file-channel";

/**
 * `CloudFilePort` for the runtime worker: every call goes to the UI
 * thread, which holds the plugin. What comes back is checked for shape
 * here, and the bytes stay untrusted until the runtime decrypts them.
 */
export function createWorkerCloudFile(scope: WorkerScope, provider: BackupProvider): CloudFilePort {
  const host = requestChannel<CloudFileHost>(scope, CLOUD_FILE_REQUEST);
  return {
    provider,
    signIn: async (interactive) => (await host.signIn(interactive)) === true,
    async read() {
      const file: unknown = await host.read();
      if (file === null) return null;
      const { bytes, updatedAt } = (file ?? {}) as Record<string, unknown>;
      if (!ArrayBuffer.isView(bytes) || typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
        throw new Error(userErrorMessage("backupUnreachable"));
      }
      return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(), updatedAt };
    },
    async write(bytes) {
      // The caller keeps its own bytes; the copy moves to the page.
      const copy = bytes.slice();
      await host.write(Comlink.transfer(copy, [copy.buffer]));
    },
    remove: () => host.remove(),
    revoke: () => host.revoke(),
  };
}
