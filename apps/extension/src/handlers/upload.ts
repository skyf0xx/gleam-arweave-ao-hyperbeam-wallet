import { scanForSecrets, submitUploadToBundler, validateTagBytes } from "@gleam/core/src/policy/index.ts";
import { base64ToBytes, type StoragePort, type UploadDraft, type UploadReview } from "@gleam/core";
import { getCachedKey } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s `reviewUpload`/
 * `submitUpload`. Same constructor-injected-`StoragePort` shape as every
 * other handler in this directory.
 *
 * Signing key source: submitting an upload needs the decrypted JWK to
 * sign the ANS-104 DataItem, read from `key-session.ts`'s in-memory cache
 * — same resolution as `handlers/transfer.ts`'s `submitTransfer`, see
 * that file's doc comment for why a password is no longer required on
 * this request. `reviewUpload` needs no signing key at all (it only
 * scans/validates), so it keeps `ProtocolMap`'s exact `UploadDraft` shape
 * unchanged.
 *
 * Bundler endpoint: no `NetworkSettings` field exists for a configurable
 * bundler URL (`packages/core/src/models/network.ts`, outside this
 * layer's scope, only carries `gatewayUrl`/`peers`) — `up.arweave.net`
 * (CLAUDE.md item 7) is hardcoded as `DEFAULT_BUNDLER_URL` below, the
 * same shape of decision `transfer.ts` made for `DEFAULT_NETWORK_
 * SETTINGS`. Flagged as debt: a later layer wanting a user-configurable
 * bundler URL needs a `NetworkSettings` field added, which is out of
 * this task's ALLOWED SCOPE.
 *
 * ANS-104 build/sign/submit logic itself lives in `@gleam/core/src/
 * policy/upload-submit.ts` — see that file's own doc comment for why a
 * `core/policy`-scoped file ended up housing arbundles-dependent logic
 * that isn't really "policy" shaped, a scope gap reported in this task's
 * final report rather than silently resolved by widening
 * `apps/extension/package.json` (which has no `@dha-team/arbundles`
 * dependency and is outside this layer's ALLOWED SCOPE to add one to).
 */
export interface SubmitUploadRequest extends UploadDraft {
  walletId: string;
}

const DEFAULT_BUNDLER_URL = "https://up.arweave.net";

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

    const cached = getCachedKey(req.walletId);
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
