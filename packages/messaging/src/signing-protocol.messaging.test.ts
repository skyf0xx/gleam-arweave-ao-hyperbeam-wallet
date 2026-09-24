import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  SigningWireContract,
  WireBatchSignDataItemResult,
  WireDispatchResult,
  WireEncryptRequest,
  WirePrivateHashRequest,
  WireSignMessageRequest,
  WireVerifyMessageRequest,
} from "./signing-protocol";
import type { TaggedArrayBuffer } from "./page-protocol";
import type { AesGcmParams, RsaOaepParams } from "@gleam/core";

/**
 * `SigningWireContract` is a type-only lookup — there is no runtime
 * dispatcher to exercise at this layer (that's `provider-bridge`'s job,
 * same as `protocol.messaging.test.ts`'s own doc comment states for
 * `ProtocolMap`). These are type-shape assertions guarding against drift
 * from Wander's confirmed conventions.
 */
describe("SigningWireContract", () => {
  it("covers all 10 signing/crypto provider-surface methods", () => {
    const methods: Array<keyof SigningWireContract> = [
      "sign",
      "dispatch",
      "signDataItem",
      "batchSignDataItem",
      "encrypt",
      "decrypt",
      "signature",
      "signMessage",
      "privateHash",
      "verifyMessage",
    ];
    expect(methods.length).toBe(10);
    expect(new Set(methods).size).toBe(methods.length);
  });

  it("dispatch resolves to {id, type?}, type optional and BASE|BUNDLED only", () => {
    expectTypeOf<WireDispatchResult>().toEqualTypeOf<{
      id: string;
      type?: "BASE" | "BUNDLED";
    }>();
    const baseResult: WireDispatchResult = { id: "msg-1", type: "BASE" };
    const bundledResult: WireDispatchResult = { id: "msg-2", type: "BUNDLED" };
    const noTypeResult: WireDispatchResult = { id: "msg-3" };
    expect(baseResult.type).toBe("BASE");
    expect(bundledResult.type).toBe("BUNDLED");
    expect(noTypeResult.type).toBeUndefined();
  });

  it("signMessage/privateHash/verifyMessage carry ArrayBuffer-derived fields as TaggedArrayBuffer on the wire", () => {
    const signMessageData: TaggedArrayBuffer = {
      __gleamType: "ArrayBuffer",
      data: [1, 2, 3],
    };
    const signMessageRequest: WireSignMessageRequest = {
      walletId: "wallet-1",
      data: signMessageData,
    };
    expect(signMessageRequest.data.__gleamType).toBe("ArrayBuffer");

    const privateHashRequest: WirePrivateHashRequest = {
      walletId: "wallet-1",
      data: { __gleamType: "ArrayBuffer", data: [4, 5, 6] },
    };
    expect(privateHashRequest.data.__gleamType).toBe("ArrayBuffer");

    const verifyMessageRequest: WireVerifyMessageRequest = {
      publicKey: "pub",
      data: { __gleamType: "ArrayBuffer", data: [1] },
      signature: { __gleamType: "ArrayBuffer", data: [2] },
    };
    expect(verifyMessageRequest.signature.__gleamType).toBe("ArrayBuffer");
  });

  it("batchSignDataItem resolves to one ArrayBuffer per item", () => {
    expectTypeOf<WireBatchSignDataItemResult>().toEqualTypeOf<ArrayBuffer[]>();
  });

  it("encrypt/decrypt's algorithm param accepts each of the 4 WebCrypto param shapes", () => {
    const rsaOaep: RsaOaepParams = { name: "RSA-OAEP" };
    const aesGcm: AesGcmParams = {
      name: "AES-GCM",
      iv: new ArrayBuffer(12),
    };
    const rsaRequest: WireEncryptRequest = {
      walletId: "wallet-1",
      data: "cGxhaW50ZXh0",
      algorithm: rsaOaep,
    };
    const gcmRequest: WireEncryptRequest = {
      walletId: "wallet-1",
      data: "cGxhaW50ZXh0",
      algorithm: aesGcm,
    };
    expect(rsaRequest.algorithm.name).toBe("RSA-OAEP");
    expect(gcmRequest.algorithm.name).toBe("AES-GCM");
  });

  it("every signing/crypto request shape carries walletId for unlocked-session key resolution, never a password", () => {
    expectTypeOf<SigningWireContract["sign"]["request"]>().toHaveProperty(
      "walletId",
    );
    expectTypeOf<
      SigningWireContract["sign"]["request"]
    >().not.toHaveProperty("password");
    expectTypeOf<SigningWireContract["dispatch"]["request"]>().toHaveProperty(
      "walletId",
    );
    expectTypeOf<
      SigningWireContract["signDataItem"]["request"]
    >().toHaveProperty("walletId");
    expectTypeOf<
      SigningWireContract["batchSignDataItem"]["request"]
    >().toHaveProperty("walletId");
    expectTypeOf<SigningWireContract["encrypt"]["request"]>().toHaveProperty(
      "walletId",
    );
    expectTypeOf<SigningWireContract["decrypt"]["request"]>().toHaveProperty(
      "walletId",
    );
    expectTypeOf<SigningWireContract["signature"]["request"]>().toHaveProperty(
      "walletId",
    );
    expectTypeOf<
      SigningWireContract["signMessage"]["request"]
    >().toHaveProperty("walletId");
    expectTypeOf<
      SigningWireContract["privateHash"]["request"]
    >().toHaveProperty("walletId");
  });

  it("verifyMessage takes a publicKey, not a walletId — verification needs no signing-session key", () => {
    expectTypeOf<
      SigningWireContract["verifyMessage"]["request"]
    >().toHaveProperty("publicKey");
    expectTypeOf<
      SigningWireContract["verifyMessage"]["request"]
    >().not.toHaveProperty("walletId");
  });
});
