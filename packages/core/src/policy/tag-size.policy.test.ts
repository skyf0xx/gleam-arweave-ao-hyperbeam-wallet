import { describe, expect, it } from "vitest";
import { validateTagBytes, TAG_BYTES_LIMIT } from "./tag-size";

function tagOfByteSize(totalBytes: number) {
  // "n" (1 byte name) + value padded to hit an exact total.
  return [{ name: "n", value: "a".repeat(totalBytes - 1) }];
}

describe("validateTagBytes", () => {
  it("is valid with no tags", () => {
    expect(validateTagBytes([])).toEqual({ valid: true });
  });

  it("is valid exactly at the 4096-byte limit", () => {
    const result = validateTagBytes(tagOfByteSize(TAG_BYTES_LIMIT));
    expect(result).toEqual({ valid: true });
  });

  it("is invalid exactly one byte over the limit", () => {
    const result = validateTagBytes(tagOfByteSize(TAG_BYTES_LIMIT + 1));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.totalBytes).toBe(TAG_BYTES_LIMIT + 1);
      expect(result.limitBytes).toBe(TAG_BYTES_LIMIT);
    }
  });

  it("sums bytes across multiple tags", () => {
    const result = validateTagBytes([
      { name: "Content-Type", value: "image/png" },
      { name: "App-Name", value: "Gleam" },
    ]);
    expect(result.valid).toBe(true);
  });

  it("counts UTF-8 byte length, not character length, for multi-byte values", () => {
    // "★" is 1 character but 3 bytes in UTF-8.
    const stars = "★".repeat(1400); // 1400 * 3 = 4200 bytes > 4096
    const result = validateTagBytes([{ name: "Description", value: stars }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.totalBytes).toBe("Description".length + 1400 * 3);
    }
  });
});
