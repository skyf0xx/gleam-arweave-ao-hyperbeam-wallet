/**
 * Saves a file to the user's downloads. Implemented by
 * `apps/extension/src/adapters/downloads.ts` over `browser.downloads`;
 * `core` and the handlers only see this interface.
 */
export type FileDownloadResult =
  | { ok: true; filename: string }
  | { ok: false; reason: "cancelled" | "failed" | "permission" };

export interface DownloadPort {
  /** Whether the browser lets the extension save files right now. */
  isAllowed(): Promise<boolean>;
  /**
   * Resolves true once the browser lets the extension save files. The
   * grant itself comes from a user gesture in an extension page, so this
   * waits a while for it to arrive and resolves false if it never does
   * or `signal` aborts first.
   */
  ensureAllowed(signal?: AbortSignal): Promise<boolean>;
  /** Resolves once the file is fully written, cancelled, or has failed. */
  saveFile(file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<FileDownloadResult>;
}
