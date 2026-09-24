import { ArweaveSigner, createData } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";
import type { UploadTag } from "../models/upload";

/**
 * This module never decrypts anything itself — it accepts an
 * already-decrypted `JWKInterface` and never imports `core/vault`,
 * matching `core/arweave/transfer.ts`'s signing-capability boundary.
 *
 * Imports from `@dha-team/arbundles/web`, not the package root: the
 * root's Node build pulls in streamed-upload helpers that import
 * `axios`, an undeclared dependency this project doesn't need (uploads
 * here are in-memory `Uint8Array` payloads). The `/web` subpath is the
 * browser-safe entry point that resolves in an MV3 service worker.
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
  const signer = new ArweaveSigner(jwk);
  const allTags: UploadTag[] = [
    { name: "Content-Type", value: contentType },
    ...tags,
    ...(licenseTag ? [licenseTag] : []),
  ];

  const dataItem = createData(data, signer, { tags: allTags });
  await dataItem.sign(signer);

  // getRaw() is typed as a Node Buffer even via the /web entry point;
  // copy into a plain Uint8Array to satisfy fetch's BodyInit typing.
  await postDataItemToBundler(bundlerUrl, new Uint8Array(dataItem.getRaw()));

  return { txId: dataItem.id };
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
