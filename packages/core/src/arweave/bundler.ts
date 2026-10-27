const BUNDLER_TX_ENDPOINT_SUFFIX = "/tx";

/**
 * POSTs an already-signed ANS-104 data item's raw bytes to
 * `<bundlerUrl>/tx`. Throws on any non-2xx response, so a caller never
 * reports an id for data the bundler didn't accept.
 */
export async function postDataItemToBundler(bundlerUrl: string, rawBytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const endpoint = new URL(BUNDLER_TX_ENDPOINT_SUFFIX, bundlerUrl).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: rawBytes,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to submit data item to bundler ${bundlerUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }
}
