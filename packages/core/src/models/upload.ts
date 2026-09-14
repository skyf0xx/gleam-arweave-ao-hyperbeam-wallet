export interface UploadTag {
  name: string;
  value: string;
}

/**
 * An in-progress upload: file/text/JSON payload, tags (byte-capped ~4096
 * bytes), optional UDL license tag (PRD §3 Glossary — UploadDraft). The
 * pre-upload secret scan referenced there runs at the `upload` layer
 * (`core/policy`), not here — this type only carries the draft's shape.
 */
export interface UploadDraft {
  contentType: string;
  /** Base64-encoded payload bytes. */
  data: string;
  tags: UploadTag[];
  licenseTag: UploadTag | null;
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
