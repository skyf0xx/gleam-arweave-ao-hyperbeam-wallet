export interface UploadTag {
  name: string;
  value: string;
}

/**
 * An in-progress upload: file/text/JSON payload, tags (byte-capped ~4096
 * bytes), optional UDL license tag (PRD §3 Glossary — UploadDraft). The
 * pre-upload secret scan referenced there runs at the `upload` layer
 * (`core/policy`), not here — this type only carries the draft's shape.
 *
 * `walletId` (added by `provider-bridge`, closing a debt the `upload`
 * layer declared): signing the ANS-104 DataItem needs the decrypted JWK,
 * read from the unlocked-session cache per the same vault boundary
 * `TransferDraft` documents. `reviewUpload` (no signing needed) simply
 * ignores this field.
 *
 * Typed optional here for the same reason `TransferDraft` is (see that
 * model's doc comment): staying structurally compatible with a locked
 * test file outside this task's ALLOWED SCOPE that predates this field.
 * `handlers/upload.ts`'s own intersection type still narrows it back to
 * required for `submitUpload`'s actual signature.
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
   * warning (PRD §4 — Upload content). Populated by the `upload` layer's
   * scanner, not by this model.
   */
  secretScanMatch: string | null;
}
