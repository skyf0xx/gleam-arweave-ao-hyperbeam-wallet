import { userErrorMessage } from "../models/user-errors";
import { trimTrailingSlashes } from "../models/network";
import { isSuccessStatus } from "../models/http";

/**
 * POSTs an already-signed ANS-104 data item's raw bytes to
 * `<bundlerUrl>/tx`. The bundler's own path is kept, so a bundler that
 * serves under one (`https://upload.ardrive.io/v1`) works as entered.
 * Throws on any non-2xx response, so a caller never reports an id for
 * data the bundler didn't accept.
 */
export async function postDataItemToBundler(bundlerUrl: string, rawBytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const endpoint = `${trimTrailingSlashes(bundlerUrl)}/tx`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: rawBytes,
  });

  if (!isSuccessStatus(response.status)) {
    throw new Error(
      userErrorMessage("bundlerSubmitFailed", { bundler: bundlerUrl, status: response.status, statusText: response.statusText }),
    );
  }
}
