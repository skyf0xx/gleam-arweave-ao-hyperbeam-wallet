import type { JWKInterface } from "../models/wallet";
import { createSignedDataItem } from "./data-item";
import type { UploadTag } from "../models/upload";

/**
 * This module never decrypts anything itself — it accepts an
 * already-decrypted `JWKInterface` and never imports `core/vault`,
 * matching `core/arweave/transfer.ts`'s signing-capability boundary.
 */

const BUNDLER_TX_ENDPOINT_SUFFIX = "/tx";

export interface SubmittedUpload {
  txId: string;
}

/**
 * Builds an ANS-104 `DataItem` from the draft's payload/tags/license tag,
 * signs it with the caller-supplied JWK, and posts the signed binary to
 * an ANS-104 bundler endpoint.
 *
 * Uses the DataItem's own locally computed `id` as the returned `txId`
 * rather than trusting a bundler response field, since ANS-104 ids are
 * deterministic from the signed binary and don't require the bundler to
 * echo one back.
 */
export async function submitUploadToBundler(
  bundlerUrl: string,
  jwk: JWKInterface,
  data: Uint8Array,
  contentType: string,
  tags: UploadTag[],
  licenseTag: UploadTag | null,
): Promise<SubmittedUpload> {
  const allTags: UploadTag[] = [
    { name: "Content-Type", value: contentType },
    ...tags,
    ...(licenseTag ? [licenseTag] : []),
  ];

  const { id, raw } = await createSignedDataItem(jwk, { data, tags: allTags });
  await postDataItemToBundler(bundlerUrl, raw);

  return { txId: id };
}

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
