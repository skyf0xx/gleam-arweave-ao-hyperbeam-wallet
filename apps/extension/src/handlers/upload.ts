import { scanForSecrets, validateTagBytes } from "@gleam/core/src/policy/index.ts";
import { submitUploadToBundler } from "@gleam/core/src/arweave/index.ts";
import { base64ToBytes, DEFAULT_BUNDLER_URL, type StoragePort, type UploadDraft, type UploadReview } from "@gleam/core";
import { getCachedKey } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s `reviewUpload`/
 * `submitUpload`. Same constructor-injected-`StoragePort` shape as every
 * other handler in this directory.
 *
 * Signing key source: submitting an upload needs the decrypted JWK to
 * sign the ANS-104 DataItem, read from `key-session.ts`'s in-memory cache
 * — same resolution as `handlers/transfer.ts`'s `submitTransfer`, so this
 * request itself carries no password. `reviewUpload` needs no signing key at all (it only
 * scans/validates), so it keeps `ProtocolMap`'s exact `UploadDraft` shape
 * unchanged.
 *
 * Bundler endpoint: no `NetworkSettings` field exists for a configurable
 * bundler URL (`packages/core/src/models/network.ts` only carries
 * `gatewayUrl`/`peers`) — `up.arweave.net` is `@gleam/core`'s
 * `DEFAULT_BUNDLER_URL`, the same shape of decision `transfer.ts` made
 * for `DEFAULT_NETWORK_SETTINGS`. A user-configurable bundler URL needs a
 * `NetworkSettings` field added.
 *
 * ANS-104 build/sign/submit logic itself lives in `@gleam/core/src/
 * arweave/upload.ts`, alongside `transfer.ts`.
 */
export interface SubmitUploadRequest extends UploadDraft {
  walletId: string;
}

export class UploadHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
  ) {}

  /**
   * Runs the pre-upload secret scan and tag byte-size validation over an
   * `UploadDraft` — no signing key needed, so this accepts `ProtocolMap`'s
   * exact `UploadDraft` shape unchanged.
   */
  reviewUpload(req: UploadDraft): UploadReview {
    const tagByteSize = req.tags.reduce(
      (sum, tag) => sum + new TextEncoder().encode(tag.name).byteLength + new TextEncoder().encode(tag.value).byteLength,
      0,
    );

    const dataBytes = base64ToBytes(req.data);
    const scanResult = scanForSecrets(dataBytes);

    return {
      tagByteSize,
      secretScanMatch: scanResult.flagged ? scanResult.matchType : null,
    };
  }

  /**
   * Signs and submits the upload as an ANS-104 DataItem to the bundler.
   * Re-runs the same review checks `reviewUpload` does — a caller that
   * skipped straight to `submitUpload` (or whose review result is stale)
   * must not be able to bypass the secret scan or tag cap this way.
   */
  async submitUpload(req: SubmitUploadRequest): Promise<{ txId: string }> {
    const review = this.reviewUpload(req);
    if (review.secretScanMatch !== null) {
      throw new Error(
        `This looks like a ${review.secretScanMatch}. Uploads are public and permanent — remove it before continuing.`,
      );
    }

    const tagCheck = validateTagBytes(req.tags);
    if (!tagCheck.valid) {
      throw new Error(
        `Tags are ${tagCheck.totalBytes} bytes — the limit is ${tagCheck.limitBytes}.`,
      );
    }

    const cached = await getCachedKey(req.walletId);
    if (!cached) {
      throw new Error(`Wallet "${req.walletId}" is locked. Unlock it to continue.`);
    }
    const dataBytes = base64ToBytes(req.data);

    return submitUploadToBundler(
      this.bundlerUrl,
      cached.jwk,
      dataBytes,
      req.contentType,
      req.tags,
      req.licenseTag,
    );
  }
}
