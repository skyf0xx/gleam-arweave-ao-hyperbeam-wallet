import { browser } from "wxt/browser";
import type { FileDownloadResult, RuntimePort } from "@gleam/core";

export type RequestDownloadsPermission = () => Promise<boolean>;

/** Must be called from a click: Chrome only shows the prompt for a user gesture. */
export const requestDownloadsPermission: RequestDownloadsPermission = () =>
  browser.permissions.request({ permissions: ["downloads"] }).catch(() => false);

/**
 * Starts the background's keyfile download, then asks for the optional
 * `downloads` permission. The request goes out first because Chrome
 * closes the action popup when the permission prompt opens; the
 * background then waits for the grant, saves the file and records the
 * backup with nobody left to answer.
 *
 * The background checks the password before it waits, so a wrong one
 * rejects here while the prompt may still be open. A denied prompt tells
 * the background to stop waiting, which drops the password it holds.
 */
export async function downloadKeyfile(
  runtime: RuntimePort,
  req: { walletId: string; password: string },
  requestPermission: RequestDownloadsPermission = requestDownloadsPermission,
): Promise<FileDownloadResult> {
  const reply = runtime.send<{ walletId: string; password: string }, FileDownloadResult>({
    type: "downloadKeyfile",
    payload: req,
  });
  const failedEarly = new Promise<never>((_, reject) => {
    reply.catch(reject);
  });
  const granted = await Promise.race([requestPermission(), failedEarly]);
  if (!granted) {
    await runtime
      .send<{ walletId: string }, void>({ type: "cancelKeyfileDownload", payload: { walletId: req.walletId } })
      .catch(() => {});
    return { ok: false, reason: "permission" };
  }
  return reply;
}

export function keyfileDownloadError(result: FileDownloadResult): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case "cancelled":
      return "The download was cancelled.";
    case "failed":
      return "The keyfile couldn't be saved.";
    case "permission":
      return "Gleam needs permission to manage downloads to save your keyfile. Nothing was downloaded.";
  }
}
