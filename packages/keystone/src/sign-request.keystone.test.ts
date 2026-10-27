import { describe, expect, it } from "vitest";
import { ArweaveSignature, ArweaveSignRequest, SignType } from "@keystonehq/bc-ur-registry-arweave";
import { UR, URDecoder, UREncoder } from "@ngraveio/bc-ur";
import type { DeviceSigningPayload } from "@gleam/core";
import {
  buildKeystoneSignRequest,
  decodeKeystoneSignature,
  KEYSTONE_FRAGMENT_LENGTH,
  KEYSTONE_MAX_FRAMES,
  KEYSTONE_MAX_TRANSACTION_DATA,
  keystoneQrEncoder,
  KeystoneRequestError,
  KeystoneSignatureError,
} from "./sign-request";

const xfp = "f23f9fd2";
const requestId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const owner = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)).toString("base64url");

const transaction: DeviceSigningPayload & { kind: "transaction" } = {
  kind: "transaction",
  transaction: {
    format: 2,
    id: "",
    last_tx: "anchor",
    owner,
    tags: [{ name: "QXBw", value: "R2xlYW0" }],
    target: "t".repeat(43),
    quantity: "1000",
    data: "",
    data_size: "0",
    data_root: "",
    reward: "42",
    signature: "",
  },
};

function roundTrip(ur: UR): UR {
  const encoder = keystoneQrEncoder(ur);
  const decoder = new URDecoder();
  for (let i = 0; i < 1000 && !decoder.isComplete(); i++) decoder.receivePart(encoder.nextPart());
  expect(decoder.isSuccess()).toBe(true);
  return decoder.resultUR();
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

describe("buildKeystoneSignRequest", () => {
  it("sends a transaction as its JSON, with owner, and survives the animated QR", () => {
    const { ur, requestId: id } = buildKeystoneSignRequest(transaction, xfp, requestId);
    expect(id).toBe(requestId);
    expect(ur.type).toBe("arweave-sign-request");

    const request = ArweaveSignRequest.fromCBOR(roundTrip(ur).cbor);
    expect(request.getSignType()).toBe(SignType.Transaction);
    expect(request.getSaltLen()).toBe(32);
    expect(request.getMasterFingerprint().toString("hex")).toBe(xfp);
    expect(request.getRequestId().toString("hex")).toBe(uuidBytes(requestId).toString("hex"));
    const sent = JSON.parse(request.getSignData().toString("utf-8")) as typeof transaction.transaction;
    expect(sent).toEqual(transaction.transaction);
    expect(sent.owner).toBe(owner);
  });

  it("sends a data item's raw bytes", () => {
    const raw = Buffer.from(Array.from({ length: 1500 }, (_, i) => (i * 3) % 256));
    const { ur } = buildKeystoneSignRequest({ kind: "dataItem", raw: raw.toString("base64url") }, xfp, requestId);
    const request = ArweaveSignRequest.fromCBOR(roundTrip(ur).cbor);
    expect(request.getSignType()).toBe(SignType.DataItem);
    expect(Buffer.compare(request.getSignData(), raw)).toBe(0);
  });

  it("sends a message's raw bytes as a Message request, for the device to hash and sign", () => {
    const message = Buffer.from("Sign in to example.com", "utf-8");
    const { ur } = buildKeystoneSignRequest({ kind: "message", data: message.toString("base64url") }, xfp, requestId);
    const request = ArweaveSignRequest.fromCBOR(roundTrip(ur).cbor);
    expect(request.getSignType()).toBe(SignType.Message);
    expect(Buffer.compare(request.getSignData(), message)).toBe(0);
  });

  it("generates a request id when none is given", () => {
    const { requestId: id } = buildKeystoneSignRequest(transaction, xfp);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a transaction whose data can't fit the frame cap, naming the real limit", () => {
    const big = {
      ...transaction,
      transaction: { ...transaction.transaction, data_size: String(KEYSTONE_MAX_TRANSACTION_DATA + 1) },
    };
    expect(() => buildKeystoneSignRequest(big, xfp)).toThrow(KeystoneRequestError);
    expect(() => buildKeystoneSignRequest(big, xfp)).toThrow(
      `more than ${Math.floor(KEYSTONE_MAX_TRANSACTION_DATA / 1000)} KB`,
    );
  });

  it("accepts a transaction with data right at the limit, and it still fits the frame cap", () => {
    const data = Buffer.alloc(KEYSTONE_MAX_TRANSACTION_DATA, 9).toString("base64url");
    const full = {
      ...transaction,
      transaction: { ...transaction.transaction, data, data_size: String(KEYSTONE_MAX_TRANSACTION_DATA) },
    };
    const { ur } = buildKeystoneSignRequest(full, xfp);
    expect(() => keystoneQrEncoder(ur)).not.toThrow();
  });
});

describe("keystoneQrEncoder", () => {
  it("refuses a request that would need too many frames", () => {
    const raw = Buffer.alloc(KEYSTONE_FRAGMENT_LENGTH * (KEYSTONE_MAX_FRAMES + 5), 7);
    const { ur } = buildKeystoneSignRequest({ kind: "dataItem", raw: raw.toString("base64url") }, xfp);
    expect(() => keystoneQrEncoder(ur)).toThrow(/too large to show as a QR/);
  });
});

describe("decodeKeystoneSignature", () => {
  const signature = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 11) % 256));

  it("returns the signature as base64url when the request id matches", () => {
    const ur = new ArweaveSignature(signature, uuidBytes(requestId)).toUR();
    const decoded = decodeKeystoneSignature(roundTrip(ur), requestId);
    expect(decoded).toBe(signature.toString("base64url"));
  });

  it("accepts a signature that carries no request id", () => {
    const ur = new ArweaveSignature(signature).toUR();
    expect(decodeKeystoneSignature(ur, requestId)).toBe(signature.toString("base64url"));
  });

  it("refuses a signature for another request", () => {
    const ur = new ArweaveSignature(signature, uuidBytes("00000000-0000-4000-8000-000000000000")).toUR();
    expect(() => decodeKeystoneSignature(ur, requestId)).toThrow(
      expect.objectContaining({ reason: "wrong-request" }) as Error,
    );
  });

  it("refuses another UR type", () => {
    const ur = new UR(Buffer.from([0x01]), "arweave-crypto-account");
    expect(() => decodeKeystoneSignature(ur, requestId)).toThrow(KeystoneSignatureError);
  });

  it("decodes a single-part signature QR", () => {
    const ur = new ArweaveSignature(signature, uuidBytes(requestId)).toUR();
    const decoder = new URDecoder();
    decoder.receivePart(UREncoder.encodeSinglePart(ur));
    expect(decodeKeystoneSignature(decoder.resultUR(), requestId)).toBe(signature.toString("base64url"));
  });
});
