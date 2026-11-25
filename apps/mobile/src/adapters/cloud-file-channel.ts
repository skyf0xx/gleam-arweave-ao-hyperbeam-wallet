/**
 * What the runtime worker and the UI thread share about the vault
 * backup's cloud file. It imports no plugin, so the worker bundle stays
 * free of Capacitor, whose native bridge only exists on the page.
 */
import type { CloudFilePort } from "@gleam/core/src/ports/cloud-file.ts";
import { serveOnce } from "./comlink-guard";

/**
 * The cloud file, served to the runtime worker. Google's authorization and
 * CloudKit are Capacitor plugins, so the file is reached from the UI
 * thread and the worker calls in. Android's Drive requests run there too,
 * so the access token never leaves the page.
 */
export type CloudFileHost = Omit<CloudFilePort, "provider">;

/** The message a worker sends to ask for the cloud file, carrying its end of the channel. */
export const CLOUD_FILE_REQUEST = "gleam:cloud-file";

const METHODS = ["signIn", "read", "write", "remove", "revoke"] as const satisfies ReadonlyArray<keyof CloudFileHost>;

/**
 * Serves `file` to the worker on the channel it opens in
 * `createWorkerCloudFile`. Only the first request is served.
 */
export function serveCloudFile(worker: Worker, file: CloudFileHost): void {
  serveOnce(worker, CLOUD_FILE_REQUEST, file, METHODS);
}
