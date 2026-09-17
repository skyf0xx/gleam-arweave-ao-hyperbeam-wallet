import type {
  BatchSignDataItemRequest,
  BatchSignDataItemResult,
  DecryptRequest,
  DecryptResult,
  DispatchRequest,
  DispatchResult,
  EncryptRequest,
  EncryptResult,
  PrivateHashRequest,
  PrivateHashResult,
  SignatureRequest,
  SignatureResult,
  SignDataItemRequest,
  SignDataItemResult,
  SignMessageRequest,
  SignMessageResult,
  SignRequest,
  SignResult,
  VerifyMessageRequest,
  VerifyMessageResult,
} from "@gleam/core";
import type { TaggedArrayBuffer } from "./page-protocol";

/**
 * The 10 signing/crypto provider-surface methods' wire-level request
 * shapes — `core/models/signing.ts`'s logical `*Request` types with every
 * `ArrayBuffer` field replaced by `TaggedArrayBuffer`, the same tagged
 * encoding `page-protocol.ts` already defines for values that don't
 * survive the `postMessage`/`@webext-core/messaging` JSON boundary intact.
 *
 * Every one of these is relayed through `ProtocolMap.providerCall`
 * (`protocol.ts`) exactly like every other provider-surface method — none
 * gets its own `ProtocolMap` entry, matching `transferAoTokens`'s existing
 * precedent of being reachable only through `providerCall`'s generic
 * `params: unknown` relay, not a dedicated method. This file exists so a
 * later `provider-bridge` layer's dispatcher has a name for each method's
 * concrete wire-request/response pairing to narrow `providerCall`'s
 * `unknown` params/return against, rather than reinventing the shape at
 * that layer.
 *
 * Approval routing and the actual cryptographic execution are later
 * layers' job — this layer only pins the wire shape.
 */
export type WireSignRequest = SignRequest;
export type WireSignResult = SignResult;

export type WireDispatchRequest = DispatchRequest;
export type WireDispatchResult = DispatchResult;

export type WireSignDataItemRequest = SignDataItemRequest;
export type WireSignDataItemResult = SignDataItemResult;

export type WireBatchSignDataItemRequest = BatchSignDataItemRequest;
export type WireBatchSignDataItemResult = BatchSignDataItemResult;

export type WireEncryptRequest = EncryptRequest;
export type WireEncryptResult = EncryptResult;

export type WireDecryptRequest = DecryptRequest;
export type WireDecryptResult = DecryptResult;

/**
 * `signature()` is ArConnect-deprecated — superseded by `sign`/
 * `signMessage`/`signDataItem` per Wander's own docs — kept only because
 * `PROVIDER_SURFACE_METHODS` still lists it for existing dApp
 * compatibility. New integrations should prefer `sign`/`signMessage`/
 * `signDataItem` instead.
 */
export type WireSignatureRequest = SignatureRequest;
export type WireSignatureResult = SignatureResult;

/**
 * `signMessage`/`privateHash` accept an `ArrayBuffer` directly per
 * Wander's confirmed convention. Across the wire envelope, `data` (and
 * `signMessage`'s `signature` result / `verifyMessage`'s `signature` input)
 * is carried as a `TaggedArrayBuffer`, the same encoding
 * `page-protocol.ts` already uses for binary payloads that don't survive
 * `postMessage` intact — the content-script/provider-script bridge is
 * responsible for tagging/untagging at the boundary, not this type.
 */
export type WireSignMessageRequest = Omit<SignMessageRequest, "data"> & {
  data: TaggedArrayBuffer;
};
export type WireSignMessageResult = Omit<SignMessageResult, "signature"> & {
  signature: TaggedArrayBuffer;
};

export type WirePrivateHashRequest = Omit<PrivateHashRequest, "data"> & {
  data: TaggedArrayBuffer;
};
export type WirePrivateHashResult = Omit<PrivateHashResult, "hash"> & {
  hash: TaggedArrayBuffer;
};

export type WireVerifyMessageRequest = Omit<
  VerifyMessageRequest,
  "data" | "signature"
> & {
  data: TaggedArrayBuffer;
  signature: TaggedArrayBuffer;
};
export type WireVerifyMessageResult = VerifyMessageResult;

/**
 * Maps each signing/crypto `ProviderSurfaceMethod` to its wire request/
 * result pair — the lookup a later `provider-bridge` dispatcher narrows
 * `providerCall`'s `params: unknown`/`unknown` return against for these 10
 * methods specifically.
 */
export interface SigningWireContract {
  sign: { request: WireSignRequest; result: WireSignResult };
  dispatch: { request: WireDispatchRequest; result: WireDispatchResult };
  signDataItem: {
    request: WireSignDataItemRequest;
    result: WireSignDataItemResult;
  };
  batchSignDataItem: {
    request: WireBatchSignDataItemRequest;
    result: WireBatchSignDataItemResult;
  };
  encrypt: { request: WireEncryptRequest; result: WireEncryptResult };
  decrypt: { request: WireDecryptRequest; result: WireDecryptResult };
  /** @deprecated ArConnect-deprecated — superseded by `sign`/`signMessage`/`signDataItem`. */
  signature: { request: WireSignatureRequest; result: WireSignatureResult };
  signMessage: {
    request: WireSignMessageRequest;
    result: WireSignMessageResult;
  };
  privateHash: {
    request: WirePrivateHashRequest;
    result: WirePrivateHashResult;
  };
  verifyMessage: {
    request: WireVerifyMessageRequest;
    result: WireVerifyMessageResult;
  };
}
