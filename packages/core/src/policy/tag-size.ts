import type { UploadTag } from "../models/upload";

/**
 * ANS-104's own tag-byte-size cap. Matches `@dha-team/arbundles`'
 * `DataItem.MAX_TAG_BYTES` (also 4096) — not re-imported from arbundles
 * here to keep this pure-domain module dependency-free.
 */
export const TAG_BYTES_LIMIT = 4096;

export type TagValidationResult =
  | { valid: true }
  | { valid: false; totalBytes: number; limitBytes: number };

function tagByteSize(tag: UploadTag): number {
  return new TextEncoder().encode(tag.name).byteLength + new TextEncoder().encode(tag.value).byteLength;
}

/**
 * Sums each tag's name+value byte length against the ~4096-byte cap.
 * Byte-accurate (UTF-8 encoded), not character-counted, since ANS-104
 * tags are serialized as bytes.
 */
export function validateTagBytes(tags: UploadTag[]): TagValidationResult {
  const totalBytes = tags.reduce((sum, tag) => sum + tagByteSize(tag), 0);
  if (totalBytes > TAG_BYTES_LIMIT) {
    return { valid: false, totalBytes, limitBytes: TAG_BYTES_LIMIT };
  }
  return { valid: true };
}
