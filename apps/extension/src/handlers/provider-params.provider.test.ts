import { describe, expect, it } from "vitest";
import {
  decodeProviderParams,
  encodeProviderResult,
  readBytes,
  readDataItem,
  readDataItems,
  readEncryptAlgorithm,
  readHashAlgorithm,
  readSaltLength,
  readTransaction,
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

describe("readSaltLength", () => {
  it("reads saltLength from RSA-PSS params and rejects anything else", () => {
    expect(readSaltLength({ name: "RSA-PSS", saltLength: 0 }, "signature")).toBe(0);
    expect(readSaltLength({ saltLength: 64 }, "signature")).toBe(64);
    expect(readSaltLength(undefined, "signature")).toBeUndefined();
    expect(readSaltLength({ name: "RSA-PSS" }, "signature")).toBeUndefined();
    expect(() => readSaltLength({ name: "RSASSA-PKCS1-v1_5" }, "signature")).toThrow(/RSA-PSS/);
    expect(() => readSaltLength({ saltLength: -1 }, "signature")).toThrow(/non-negative integer/);
    expect(() => readSaltLength({ saltLength: 1.5 }, "signature")).toThrow(/non-negative integer/);
    expect(() => readSaltLength({ saltLength: "32" }, "signature")).toThrow(/non-negative integer/);
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

describe("readTransaction", () => {
  const target = "a".repeat(43);

  // What arweave-js's Transaction.toJSON() produces for a dApp's transaction.
  const toJsonOutput = {
    format: 2,
    id: "",
    last_tx: "b".repeat(64),
    owner: "",
    tags: [
      { name: "Q29udGVudC1UeXBl", value: "dGV4dC9wbGFpbg" },
      { name: "QXBwLU5hbWU", value: "R2xlYW0g4pyT" },
    ],
    target,
    quantity: "1000",
    data: "aGVsbG8",
    data_size: "5",
    data_root: "",
    reward: "5000",
    signature: "",
  };

  it("decodes arweave-js's toJSON() data and tags", () => {
    const transaction = readTransaction(toJsonOutput, "sign");
    expect(new TextDecoder().decode(transaction.data)).toBe("hello");
    expect(transaction.tags).toEqual([
      { name: "Content-Type", value: "text/plain" },
      { name: "App-Name", value: "Gleam ✓" },
    ]);
    expect(transaction).toMatchObject({
      target,
      quantity: "1000",
      reward: "5000",
      last_tx: "b".repeat(64),
    });
  });

  it("survives the page → background tagged-binary hop", () => {
    const params = decodeProviderParams({ transaction: toJsonOutput, options: {} });
    expect(new TextDecoder().decode(readTransaction(params.transaction, "sign").data)).toBe("hello");
  });

  it("accepts a plain object with binary data", () => {
    const params = decodeProviderParams({
      transaction: { data: { __gleamType: "Uint8Array", data: [1, 2, 3] } },
    });
    expect(Array.from(readTransaction(params.transaction, "dispatch").data)).toEqual([1, 2, 3]);
  });

  it("treats arweave-js's empty defaults as unset", () => {
    const transaction = readTransaction(
      { ...toJsonOutput, target: "", last_tx: "", reward: "0", tags: [] },
      "dispatch",
    );
    expect(transaction.target).toBeUndefined();
    expect(transaction.last_tx).toBeUndefined();
    expect(transaction.reward).toBeUndefined();
    expect(transaction.tags).toEqual([]);
  });

  it("rejects what can't be signed as given", () => {
    expect(() => readTransaction(undefined, "sign")).toThrow(/requires a transaction/);
    expect(() => readTransaction({ ...toJsonOutput, target: "not-an-address" }, "sign")).toThrow(/target/);
    expect(() => readTransaction({ ...toJsonOutput, quantity: "1.5" }, "sign")).toThrow(/quantity/);
    expect(() => readTransaction({ ...toJsonOutput, data: "not base64!" }, "sign")).toThrow(/base64url/);
    expect(() => readTransaction({ ...toJsonOutput, tags: [{ name: "__4", value: "" }] }, "sign")).toThrow(
      /UTF-8/,
    );
    expect(() => readTransaction({ ...toJsonOutput, tags: [{ name: 1, value: "" }] }, "sign")).toThrow(
      /string name and value/,
    );
  });
});

describe("readDataItem", () => {
  const target = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";

  it("takes data as UTF-8 text or bytes, and tags as plain text", () => {
    const fromText = readDataItem(
      { data: "hé", tags: [{ name: "Action", value: "Eval" }], target, anchor: "a".repeat(32) },
      "signDataItem",
    );
    expect(new TextDecoder().decode(fromText.data)).toBe("hé");
    expect(fromText).toMatchObject({ tags: [{ name: "Action", value: "Eval" }], target, anchor: "a".repeat(32) });

    const fromBytes = readDataItem({ data: new Uint8Array([1, 2]) }, "signDataItem");
    expect(Array.from(fromBytes.data)).toEqual([1, 2]);
    expect(fromBytes).toMatchObject({ tags: [], target: undefined, anchor: undefined });
  });

  it("rejects what can't be signed as given", () => {
    expect(() => readDataItem(undefined, "signDataItem")).toThrow(/requires a data item/);
    expect(() => readDataItem({}, "signDataItem")).toThrow(/needs data/);
    expect(() => readDataItem({ data: "x", tags: "Action" }, "signDataItem")).toThrow(/tags must be an array/);
    expect(() => readDataItem({ data: "x", tags: [{ name: "Action" }] }, "signDataItem")).toThrow(/string name and value/);
    expect(() => readDataItem({ data: "x", target: "short" }, "signDataItem")).toThrow(/Arweave address/);
    expect(() => readDataItem({ data: "x", anchor: "short" }, "signDataItem")).toThrow(/32 bytes/);
  });
});

describe("readDataItems", () => {
  it("reads every item and rejects an empty or non-array batch", () => {
    expect(readDataItems([{ data: "a" }, { data: "b" }])).toHaveLength(2);
    expect(() => readDataItems([])).toThrow(/non-empty array/);
    expect(() => readDataItems({ data: "a" })).toThrow(/non-empty array/);
    expect(() => readDataItems([{ data: "a" }, {}])).toThrow(/batchSignDataItem: the data item needs data/);
  });
});
