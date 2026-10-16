import { describe, expect, it } from "vitest";
import { keyfileFilename } from "./keyfile-filename";

describe("keyfileFilename", () => {
  it("dash-joins and lowercases the wallet name", () => {
    expect(keyfileFilename("Rose Quartz")).toBe("rose-quartz-arweave-keyfile.json");
  });

  it("replaces characters a download filename can't hold", () => {
    expect(keyfileFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j-arweave-keyfile.json");
  });

  it("never starts with a dot, which would hide the file or climb a directory", () => {
    expect(keyfileFilename("../evil")).toBe("evil-arweave-keyfile.json");
  });

  it("falls back to a plain name when nothing usable is left", () => {
    expect(keyfileFilename("   ")).toBe("arweave-keyfile.json");
  });

  it("drops bidi controls that would reorder the shown name", () => {
    expect(keyfileFilename("abc\u202Enosj.exe")).toBe("abcnosj.exe-arweave-keyfile.json");
  });

  it("caps a very long name", () => {
    expect(keyfileFilename("a".repeat(500))).toBe(`${"a".repeat(64)}-arweave-keyfile.json`);
  });
});
