export interface UploadTag {
  name: string;
  value: string;
}

/**
 * An in-progress upload: file/text/JSON payload, tags (byte-capped ~4096
 * bytes), optional UDL license tag. The pre-upload secret scan runs at
 * the `upload` layer (`core/policy`), not here — this type only carries
 * the draft's shape.
 *
 * `walletId` is typed optional, matching `TransferDraft`'s convention:
 * `reviewUpload` (no signing needed) simply ignores it, while
 * `handlers/upload.ts`'s intersection type narrows it back to required
 * for `submitUpload`'s actual signature.
 */
export interface UploadDraft {
  contentType: string;
  /** Base64-encoded payload bytes. */
  data: string;
  tags: UploadTag[];
  licenseTag: UploadTag | null;
  walletId?: string;
}

export interface UploadReview {
  tagByteSize: number;
  /**
   * Non-null when the pre-upload secret scan flags the payload; names the
   * specific match type (e.g. "JWK", "PEM block") rather than a generic
   * warning. Populated by the `upload` layer's scanner, not by this model.
   */
  secretScanMatch: string | null;
}
