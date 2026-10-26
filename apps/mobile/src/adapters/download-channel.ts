/**
 * What the runtime worker and the UI thread share about saving a file. It
 * imports no plugin, so the worker bundle stays free of Capacitor, whose
 * native bridge only exists on the page.
 */
import type { FileDownloadResult } from "@gleam/core";

/**
 * Hands a file to the phone's share sheet, served to the runtime worker.
 * Filesystem and Share are Capacitor plugins, so they run on the UI thread
 * and the worker calls in.
 */
export interface FileSaver {
  save(file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<FileDownloadResult>;
}

/** The message a worker sends to ask for the saver, carrying its end of the channel. */
export const SAVER_REQUEST = "gleam:file-saver";
