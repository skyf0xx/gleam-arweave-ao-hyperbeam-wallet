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
 * `walletId`/`password` (added by `provider-bridge`, closing a debt the
 * `upload` layer declared): signing the ANS-104 DataItem needs the
 * decrypted JWK, re-derived from the password on every call per the same
 * vault boundary `TransferDraft` documents. Both fields were previously
 * bolted on locally by `handlers/upload.ts` as
 * `UploadDraft & { walletId; password }`; `reviewUpload` (no signing
 * needed) simply ignores them.
 *
 * Typed optional here for the same reason `TransferDraft` is (see that
 * model's doc comment): staying structurally compatible with a locked
 * test file outside this task's ALLOWED SCOPE that predates these
 * fields. `handlers/upload.ts`'s own intersection type still narrows
 * them back to required for `submitUpload`'s actual signature.
 */
export interface UploadDraft {
  contentType: string;
  /** Base64-encoded payload bytes. */
  data: string;
  tags: UploadTag[];
  licenseTag: UploadTag | null;
  walletId?: string;
  password?: string;
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
