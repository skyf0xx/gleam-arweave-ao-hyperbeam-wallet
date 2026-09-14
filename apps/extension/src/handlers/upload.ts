import { scanForSecrets, submitUploadToBundler, validateTagBytes } from "@gleam/core/src/policy/index.ts";
import {
  base64ToBytes,
  decryptFromEnvelope,
  zeroize,
  type JWKInterface,
  type StoragePort,
  type UploadDraft,
  type UploadReview,
  type Wallet,
} from "@gleam/core";

/**
 * Background-side implementation of `ProtocolMap`'s `reviewUpload`/
 * `submitUpload`. Same constructor-injected-`StoragePort` shape as every
 * other handler in this directory.
 *
 * Signing-capability boundary (reported per this task's packet, matching
 * `handlers/transfer.ts`'s own documented resolution rather than
 * inventing a different one): submitting an upload needs the decrypted
 * JWK to sign the ANS-104 DataItem, but `ProtocolMap.submitUpload(req:
 * UploadDraft)` (locked, `messaging`'s scope) and `UploadDraft` itself
 * (`core/models/upload.ts`, also `messaging`'s scope) carry no
 * `walletId`/`password` field — the identical gap `transfer.ts`
 * documents for `TransferDraft`/`submitTransfer`. This handler's
 * `submitUpload` accepts `UploadDraft & { walletId: string; password:
 * string }`, the same widened-request-shape pattern as
 * `SubmitTransferRequest`, for the same forward-compatibility reason:
 * it's satisfiable by any caller that already has `ProtocolMap`'s
 * `UploadDraft` in hand plus the two extra fields, and only the type
 * import would need to tighten if `walletId`/`password` are ever added
 * to `UploadDraft` itself. `reviewUpload` needs no signing key at all
 * (it only scans/validates), so it keeps `ProtocolMap`'s exact
 * `UploadDraft` shape unchanged.
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
  password: string;
}

const WALLETS_KEY = "local:wallets";
const DEFAULT_BUNDLER_URL = "https://up.arweave.net";

function isValidWallet(value: unknown): value is Wallet {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.address === "string";
}

export class UploadHandler {
  constructor(
    private readonly storage: StoragePort,
    private readonly bundlerUrl: string = DEFAULT_BUNDLER_URL,
  ) {}

  private async loadWallet(walletId: string): Promise<Wallet> {
    const raw = await this.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(raw) ? raw.filter(isValidWallet) : [];
    const wallet = wallets.find((candidate) => candidate.id === walletId);
    if (!wallet) {
      throw new Error(`No stored wallet with id "${walletId}".`);
    }
    return wallet;
  }

  /**
   * Decrypts a wallet's JWK for one signing operation, same shape as
   * `TransferHandler`'s private `unlockSigningKey` — the plaintext is
   * the caller's responsibility to zeroize once used.
   */
  private async unlockSigningKey(walletId: string, password: string): Promise<JWKInterface> {
    const wallet = await this.loadWallet(walletId);
    if (!wallet.encryptedKeyfile) {
      throw new Error(`Wallet "${walletId}" has no key material to sign with.`);
    }
    const plaintext = await decryptFromEnvelope(wallet.encryptedKeyfile, password, wallet.id, wallet.address);
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as JWKInterface;
    } finally {
      zeroize(plaintext);
    }
  }

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

    const jwk = await this.unlockSigningKey(req.walletId, req.password);
    const dataBytes = base64ToBytes(req.data);

    return submitUploadToBundler(
      this.bundlerUrl,
      jwk,
      dataBytes,
      req.contentType,
      req.tags,
      req.licenseTag,
    );
  }
}
