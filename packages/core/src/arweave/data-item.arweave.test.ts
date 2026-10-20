import { beforeAll, describe, expect, it } from "vitest";
import { signerFromJwk, generateJWK } from "../signer/keys";
import { ArweaveSigner, createData, DataItem } from "@dha-team/arbundles/web";
import type { JWKInterface } from "../models/wallet";
import {
  applyDataItemSignature,
  buildUnsignedDataItem,
  createSignedDataItem,
  dataItemSignatureData,
  readDataItemFields,
  signDataItemWithSigner,
  verifyDataItemSignature,
  type DataItemFields,
} from "./data-item";
import { signRsaPss } from "./rsa-pss";

const TARGET = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
const ANCHOR = "fixed-anchor-for-golden-tests-32";

let jwk: JWKInterface;
let otherJwk: JWKInterface;

beforeAll(async () => {
  [jwk, otherJwk] = await Promise.all([generateJWK(), generateJWK()]);
}, 30_000);

// Uint8Array.from: jsdom's TextEncoder returns another realm's array.
const utf8 = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

const CASES: Array<[string, DataItemFields]> = [
  ["target, anchor and tags", { data: utf8("payload"), target: TARGET, anchor: ANCHOR, tags: [{ name: "App-Name", value: "Gleam ✓" }] }],
  ["no target, anchor or tags", { data: utf8("bare") }],
  ["tags only, empty data", { data: new Uint8Array(), tags: [{ name: "Content-Type", value: "text/plain" }, { name: "A", value: "" }] }],
  ["empty target and anchor strings", { data: utf8("x"), target: "", anchor: "" }],
];

function arbundlesItem(fields: DataItemFields): DataItem {
  return createData(fields.data, new ArweaveSigner(jwk), {
    target: fields.target,
    anchor: fields.anchor,
    tags: fields.tags,
  });
}

describe("buildUnsignedDataItem", () => {
  it.each(CASES)("matches arbundles' unsigned createData bytes and deep hash (%s)", async (_, fields) => {
    const reference = arbundlesItem(fields);
    const unsigned = buildUnsignedDataItem(jwk.n, fields);

    expect(Buffer.from(unsigned).equals(reference.getRaw())).toBe(true);
    expect(Buffer.from(await dataItemSignatureData(unsigned)).equals(Buffer.from(await reference.getSignatureData()))).toBe(true);
  });

  it.each(CASES)("produces arbundles' exact signed bytes and id given arbundles' signature (%s)", async (_, fields) => {
    const reference = arbundlesItem(fields);
    await reference.sign(new ArweaveSigner(jwk));

    const { id, raw } = await applyDataItemSignature(buildUnsignedDataItem(jwk.n, fields), reference.rawSignature, jwk.n);

    expect(Buffer.from(raw).equals(reference.getRaw())).toBe(true);
    expect(id).toBe(reference.id);
  });

  it.each(CASES)("readDataItemFields decodes what was built (%s)", (_, fields) => {
    const read = readDataItemFields(buildUnsignedDataItem(jwk.n, fields));
    expect(read.target).toBe(fields.target ?? "");
    expect(read.anchor).toBe(fields.anchor ?? "");
    expect(read.tags).toEqual(fields.tags ?? []);
    expect(Array.from(read.data)).toEqual(Array.from(fields.data));
  });

  it("readDataItemFields decodes arbundles' tag encoding too", () => {
    const tags = Array.from({ length: 70 }, (_, index) => ({ name: `Name-${index}`, value: "v".repeat(index) }));
    expect(readDataItemFields(arbundlesItem({ data: utf8("x"), tags }).getRaw()).tags).toEqual(tags);
  });

  it("rejects an owner that isn't a 512-byte modulus", () => {
    expect(() => buildUnsignedDataItem("AQAB", { data: utf8("x") })).toThrow(/512-byte RSA modulus/);
  });

  it("rejects a target that isn't a 32-byte id and an anchor that isn't 32 bytes", () => {
    expect(() => buildUnsignedDataItem(jwk.n, { data: utf8("x"), target: "not-an-id" })).toThrow(/32-byte Arweave id/);
    expect(() => buildUnsignedDataItem(jwk.n, { data: utf8("x"), anchor: "short" })).toThrow(/anchor must be 32 bytes/);
  });
});

describe("keyfile signing", () => {
  it("createSignedDataItem verifies over arbundles' parse and matches its unsigned layout outside the signature", async () => {
    const fields = CASES[0]![1];
    const { id, raw } = await createSignedDataItem(signerFromJwk(jwk, ""), fields);
    const parsed = new DataItem(Buffer.from(raw));
    const reference = arbundlesItem(fields).getRaw();

    expect(Buffer.from(raw.subarray(514)).equals(reference.subarray(514))).toBe(true);
    expect(parsed.id).toBe(id);
    expect(await verifyDataItemSignature(buildUnsignedDataItem(jwk.n, fields), parsed.rawSignature, jwk.n)).toBe(true);
  });

  it("refuses to sign an item owned by another key", async () => {
    await expect(signDataItemWithSigner(buildUnsignedDataItem(otherJwk.n, { data: utf8("x") }), signerFromJwk(jwk, ""))).rejects.toThrow(
      /different owner/,
    );
  });
});

describe("device signatures", () => {
  /** What a hardware device does: RSA-PSS over the deep hash, never seeing a JWK in Gleam. */
  async function deviceSign(unsigned: Uint8Array, key: JWKInterface) {
    return signRsaPss(signerFromJwk(key, ""), await dataItemSignatureData(unsigned));
  }

  it("applies a signature produced from the owner's public key alone", async () => {
    const unsigned = buildUnsignedDataItem(jwk.n, CASES[0]![1]);
    const signature = await deviceSign(unsigned, jwk);

    expect(await verifyDataItemSignature(unsigned, signature, jwk.n)).toBe(true);
    const { raw } = await applyDataItemSignature(unsigned, signature, jwk.n);
    expect(Buffer.from(raw.subarray(2, 514)).equals(Buffer.from(signature))).toBe(true);
    expect(Buffer.from(raw.subarray(514)).equals(Buffer.from(unsigned.subarray(514)))).toBe(true);
  });

  it("rejects a signature over any other payload", async () => {
    const unsigned = buildUnsignedDataItem(jwk.n, { data: utf8("one") });
    const signature = await deviceSign(buildUnsignedDataItem(jwk.n, { data: utf8("two") }), jwk);

    expect(await verifyDataItemSignature(unsigned, signature, jwk.n)).toBe(false);
    await expect(applyDataItemSignature(unsigned, signature, jwk.n)).rejects.toThrow(/doesn't match/);
  });

  it("refuses an item built for and signed by another owner when applying for this one", async () => {
    const foreign = buildUnsignedDataItem(otherJwk.n, { data: utf8("x") });
    const signature = await deviceSign(foreign, otherJwk);

    await expect(applyDataItemSignature(foreign, signature, otherJwk.n)).resolves.toBeDefined();
    await expect(applyDataItemSignature(foreign, signature, jwk.n)).rejects.toThrow(/doesn't match/);
  });

  it("rejects a signature by another key, and an item naming another owner", async () => {
    const unsigned = buildUnsignedDataItem(jwk.n, { data: utf8("x") });
    const foreign = buildUnsignedDataItem(otherJwk.n, { data: utf8("x") });

    expect(await verifyDataItemSignature(unsigned, await deviceSign(foreign, otherJwk), jwk.n)).toBe(false);
    expect(await verifyDataItemSignature(foreign, await deviceSign(foreign, otherJwk), jwk.n)).toBe(false);
  });

  it("rejects a signature of the wrong length and bytes that aren't an item", async () => {
    const unsigned = buildUnsignedDataItem(jwk.n, { data: utf8("x") });
    expect(await verifyDataItemSignature(unsigned, new Uint8Array(511), jwk.n)).toBe(false);
    expect(await verifyDataItemSignature(new Uint8Array(100), new Uint8Array(512), jwk.n)).toBe(false);
  });
});

describe("tag limits", () => {
  it("rejects an oversized tag value with a clean error instead of a RangeError", () => {
    const huge = "x".repeat(2_000_000);
    expect(() => buildUnsignedDataItem(jwk.n, { data: utf8("x"), tags: [{ name: "Big", value: huge }] })).toThrow(
      /4096-byte limit/,
    );
  });

  it("accepts tags right up to the limit and matches arbundles there", () => {
    const tags = [{ name: "A", value: "v".repeat(4090) }];
    const unsigned = buildUnsignedDataItem(jwk.n, { data: utf8("x"), tags });
    expect(Buffer.from(unsigned).equals(arbundlesItem({ data: utf8("x"), tags }).getRaw())).toBe(true);
  });
});
