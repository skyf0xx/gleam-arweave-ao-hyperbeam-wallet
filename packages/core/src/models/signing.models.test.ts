import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  BatchSignDataItemRequest,
  BatchSignDataItemResult,
  DecryptRequest,
  DispatchRequest,
  DispatchResult,
  EncryptAlgorithm,
  EncryptRequest,
  PrivateHashRequest,
  PrivateHashResult,
  RsaOaepParams,
  SignatureRequest,
  SignDataItemRequest,
  SignDataItemResult,
  SignMessageRequest,
  SignMessageResult,
  SignRequest,
  VerifyMessageRequest,
  VerifyMessageResult,
} from "./signing";

describe("signing/crypto model shapes", () => {
  it("a SignRequest resolves its key via walletId, never a password field", () => {
    const request: SignRequest = {
      walletId: "wallet-1",
      transaction: { data: "cGxhaW50ZXh0" },
    };
    expectTypeOf<SignRequest>().not.toHaveProperty("password");
    expect(request.walletId).toBe("wallet-1");
  });

  it("dispatch resolves to {id, type?}, type optional and constrained to BASE|BUNDLED", () => {
    const withType: DispatchResult = { id: "msg-1", type: "BASE" };
    const withoutType: DispatchResult = { id: "msg-2" };
    expect(withType.type).toBe("BASE");
    expect(withoutType.type).toBeUndefined();
    // @ts-expect-error — type is constrained to BASE|BUNDLED, not an arbitrary string
    const invalid: DispatchResult = { id: "msg-3", type: "OTHER" };
    expect(invalid).toBeDefined();
  });

  it("a DispatchRequest carries walletId for unlocked-session key resolution", () => {
    const request: DispatchRequest = {
      walletId: "wallet-1",
      transaction: { data: "cGxhaW50ZXh0" },
    };
    expect(request.walletId).toBe("wallet-1");
  });

  it("signDataItem/batchSignDataItem request a walletId and one-or-many DataItemInput", () => {
    const single: SignDataItemRequest = {
      walletId: "wallet-1",
      dataItem: { data: "cGxhaW50ZXh0", tags: [{ name: "App", value: "Gleam" }] },
    };
    const batch: BatchSignDataItemRequest = {
      walletId: "wallet-1",
      dataItems: [{ data: "YQ==" }, { data: "Yg==" }],
    };
    expect(single.dataItem.data).toBe("cGxhaW50ZXh0");
    expect(batch.dataItems).toHaveLength(2);
  });

  it("signDataItem resolves to an ArrayBuffer and batchSignDataItem to one per item, as Wander does", () => {
    expectTypeOf<SignDataItemResult>().toEqualTypeOf<ArrayBuffer>();
    expectTypeOf<BatchSignDataItemResult>().toEqualTypeOf<ArrayBuffer[]>();
  });

  it("encrypt/decrypt's algorithm is RSA-OAEP params", () => {
    const rsaOaep: RsaOaepParams = { name: "RSA-OAEP", label: new ArrayBuffer(3) };
    expectTypeOf<EncryptAlgorithm>().toEqualTypeOf<RsaOaepParams>();

    const request: EncryptRequest = { walletId: "wallet-1", data: "cGxhaW50ZXh0", algorithm: rsaOaep };
    const decryptRequest: DecryptRequest = { walletId: "wallet-1", data: "Y2lwaGVydGV4dA==", algorithm: rsaOaep };
    expect(request.algorithm).toBe(rsaOaep);
    expect(decryptRequest.algorithm.name).toBe("RSA-OAEP");
  });

  it("signature() carries a walletId and base64 data — deprecated in favor of sign/signMessage/signDataItem", () => {
    const request: SignatureRequest = {
      walletId: "wallet-1",
      data: "cGxhaW50ZXh0",
    };
    expect(request.walletId).toBe("wallet-1");
  });

  it("signMessage/privateHash accept ArrayBuffer directly, not a base64 string", () => {
    const signMessageRequest: SignMessageRequest = {
      walletId: "wallet-1",
      data: new ArrayBuffer(8),
    };
    const signMessageResult: SignMessageResult = { signature: new ArrayBuffer(64) };
    const privateHashRequest: PrivateHashRequest = {
      walletId: "wallet-1",
      data: new ArrayBuffer(8),
    };
    const privateHashResult: PrivateHashResult = { hash: new ArrayBuffer(32) };

    expectTypeOf<SignMessageRequest["data"]>().toEqualTypeOf<ArrayBuffer>();
    expectTypeOf<PrivateHashRequest["data"]>().toEqualTypeOf<ArrayBuffer>();
    expect(signMessageRequest.data).toBeInstanceOf(ArrayBuffer);
    expect(signMessageResult.signature).toBeInstanceOf(ArrayBuffer);
    expect(privateHashRequest.data).toBeInstanceOf(ArrayBuffer);
    expect(privateHashResult.hash).toBeInstanceOf(ArrayBuffer);
  });

  it("verifyMessage takes a publicKey rather than a walletId, since verification needs no signing session", () => {
    const request: VerifyMessageRequest = {
      publicKey: "pub",
      data: new ArrayBuffer(8),
      signature: new ArrayBuffer(64),
    };
    const result: VerifyMessageResult = { valid: true };
    expectTypeOf<VerifyMessageRequest>().not.toHaveProperty("walletId");
    expect(request.publicKey).toBe("pub");
    expect(result.valid).toBe(true);
  });
});
