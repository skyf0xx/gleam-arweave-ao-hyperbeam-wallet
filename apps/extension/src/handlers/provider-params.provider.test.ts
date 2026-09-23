import { describe, expect, it } from "vitest";
import {
  decodeProviderParams,
  encodeProviderResult,
  readBytes,
  readEncryptAlgorithm,
  readHashAlgorithm,
} from "./provider-params";

describe("decodeProviderParams", () => {
  it("turns tagged binary back into bytes, at any depth", () => {
    const params = decodeProviderParams({
      data: { __gleamType: "ArrayBuffer", data: [1, 2] },
      options: { iv: { __gleamType: "Uint8Array", data: [3] } },
    });
    expect(Array.from(readBytes(params.data, "data"))).toEqual([1, 2]);
    expect(Array.from(readBytes((params.options as { iv: unknown }).iv, "iv"))).toEqual([3]);
  });

  it("treats missing params as empty and rejects non-objects", () => {
    expect(decodeProviderParams(undefined)).toEqual({});
    expect(() => decodeProviderParams("data")).toThrow(/must be an object/);
  });
});

describe("encodeProviderResult", () => {
  it("tags binary results so they survive JSON messaging", () => {
    expect(encodeProviderResult(new Uint8Array([4, 5]))).toEqual({ __gleamType: "Uint8Array", data: [4, 5] });
    expect(encodeProviderResult(true)).toBe(true);
  });
});

describe("readBytes", () => {
  it("accepts strings only in the requested encoding", () => {
    expect(new TextDecoder().decode(readBytes("hé", "data", "utf8"))).toBe("hé");
    expect(Array.from(readBytes("-_8", "signature", "base64url"))).toEqual([251, 255]);
    expect(() => readBytes("text", "data")).toThrow(/must be an ArrayBuffer or Uint8Array/);
    expect(() => readBytes(undefined, "data")).toThrow(/"data"/);
  });

  it("copies only the viewed bytes", () => {
    const view = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
    const bytes = readBytes(view, "data");
    expect(Array.from(bytes)).toEqual([1, 2]);
    expect(bytes.buffer.byteLength).toBe(2);
  });
});

describe("readHashAlgorithm", () => {
  it("returns the requested digest, undefined when absent, and rejects others", () => {
    expect(readHashAlgorithm({ hashAlgorithm: "SHA-384" }, "signMessage")).toBe("SHA-384");
    expect(readHashAlgorithm(undefined, "signMessage")).toBeUndefined();
    expect(() => readHashAlgorithm({ hashAlgorithm: "SHA-1" }, "signMessage")).toThrow(/SHA-1/);
  });
});

describe("readEncryptAlgorithm", () => {
  it("accepts WebCrypto params and rejects the deprecated and unknown forms", () => {
    expect(readEncryptAlgorithm({ name: "RSA-OAEP" }, "encrypt")).toEqual({ name: "RSA-OAEP" });
    expect(() => readEncryptAlgorithm(undefined, "decrypt")).toThrow(/requires an algorithm/);
    expect(() => readEncryptAlgorithm({ algorithm: "RSA-OAEP", hash: "SHA-256" }, "encrypt")).toThrow(/deprecated/);
    expect(() => readEncryptAlgorithm({ name: "RSA-PSS" }, "encrypt")).toThrow(/RSA-PSS/);
  });
});
