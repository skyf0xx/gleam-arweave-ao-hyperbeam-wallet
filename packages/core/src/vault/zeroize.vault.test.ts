import { describe, expect, it } from "vitest";
import { zeroize } from "./zeroize";

describe("zeroize", () => {
  it("fills a Uint8Array with zero bytes", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    zeroize(buffer);
    expect(Array.from(buffer)).toEqual([0, 0, 0, 0, 0]);
  });

  it("fills an ArrayBuffer's underlying bytes with zero", () => {
    const arrayBuffer = new Uint8Array([9, 8, 7]).buffer;
    zeroize(arrayBuffer);
    expect(Array.from(new Uint8Array(arrayBuffer))).toEqual([0, 0, 0]);
  });

  it("is a no-op on an already-zeroed buffer", () => {
    const buffer = new Uint8Array(4);
    zeroize(buffer);
    expect(Array.from(buffer)).toEqual([0, 0, 0, 0]);
  });

  it("zeroizes a Uint8Array produced by TextEncoder (guards against a realm-crossing instanceof miss)", () => {
    const encoded = new TextEncoder().encode("sensitive key material");
    zeroize(encoded);
    expect(Array.from(encoded).every((byte) => byte === 0)).toBe(true);
  });

  it("zeroizes only the view's window into a larger backing buffer", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = new Uint8Array(backing.buffer, 2, 2);
    zeroize(view);
    expect(Array.from(backing)).toEqual([1, 2, 0, 0, 5, 6]);
  });
});
