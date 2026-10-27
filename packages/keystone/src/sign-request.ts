import { ArweaveSignature, ArweaveSignRequest, SaltLen, SignType } from "@keystonehq/bc-ur-registry-arweave";
import { UREncoder, type UR } from "@ngraveio/bc-ur";
import { base64UrlToBytes, bytesToBase64Url, type DeviceSigningPayload } from "@gleam/core";

export const KEYSTONE_SIGNATURE_UR_TYPE = "arweave-signature";

/** Bytes of CBOR per animated frame. Larger frames make denser QRs the device's camera struggles with. */
export const KEYSTONE_FRAGMENT_LENGTH = 400;

/**
 * Past this many frames the user would hold the device up for over a
 * minute per pass, and a missed frame costs another pass.
 */
export const KEYSTONE_MAX_FRAMES = 200;

/**
 * The transaction travels as JSON with its data base64url-encoded (4/3 the
 * size), so the frame cap bounds the data well below one Arweave chunk. The
 * allowance covers owner, signature and tags; the frame check in
 * `keystoneQrEncoder` stays as the backstop for tag-heavy requests.
 */
const TRANSACTION_ENVELOPE_ALLOWANCE = 2 * 1024;
export const KEYSTONE_MAX_TRANSACTION_DATA =
  Math.floor((KEYSTONE_MAX_FRAMES * KEYSTONE_FRAGMENT_LENGTH * 3) / 4) - TRANSACTION_ENVELOPE_ALLOWANCE;

export class KeystoneRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeystoneRequestError";
  }
}

export class KeystoneSignatureError extends Error {
  constructor(
    readonly reason: "wrong-type" | "wrong-request",
    message: string,
  ) {
    super(message);
    this.name = "KeystoneSignatureError";
  }
}

export interface KeystoneSignRequest {
  /** UUID the Keystone echoes back in its signature. */
  requestId: string;
  ur: UR;
}

function payloadBytes(payload: DeviceSigningPayload): { bytes: Buffer; signType: SignType } {
  // The Keystone signs SHA-256(data) with RSA-PSS/SHA-256, which is `signMessage`'s scheme.
  if (payload.kind === "message") {
    return { bytes: Buffer.from(base64UrlToBytes(payload.data)), signType: SignType.Message };
  }
  if (payload.kind === "dataItem") {
    return { bytes: Buffer.from(base64UrlToBytes(payload.raw)), signType: SignType.DataItem };
  }
  const { transaction } = payload;
  // Written so a missing or non-numeric size (NaN) is refused too.
  if (!(Number(transaction.data_size) <= KEYSTONE_MAX_TRANSACTION_DATA)) {
    throw new KeystoneRequestError(
      `This transaction carries more than ${Math.floor(KEYSTONE_MAX_TRANSACTION_DATA / 1000)} KB of data, which is too much to show as a QR for Keystone to sign. Try a smaller request.`,
    );
  }
  // The Keystone parses the transaction's JSON and needs `owner` in it to
  // compute the deep hash; the background always builds it with one.
  return { bytes: Buffer.from(JSON.stringify(transaction), "utf-8"), signType: SignType.Transaction };
}

/** The `arweave-sign-request` UR for one payload, RSA-PSS with a 32-byte salt like every Arweave signature. */
export function buildKeystoneSignRequest(
  payload: DeviceSigningPayload,
  xfp: string,
  requestId: string = crypto.randomUUID(),
): KeystoneSignRequest {
  const { bytes, signType } = payloadBytes(payload);
  const request = ArweaveSignRequest.constructArweaveRequest(bytes, xfp, signType, SaltLen.Digest, requestId);
  return { requestId, ur: request.toUR() };
}

/** Frames for the animated QR. Throws `KeystoneRequestError` when there would be too many to scan. */
export function keystoneQrEncoder(ur: UR): UREncoder {
  const encoder = new UREncoder(ur, KEYSTONE_FRAGMENT_LENGTH);
  if (encoder.fragmentsLength > KEYSTONE_MAX_FRAMES) {
    throw new KeystoneRequestError(
      `This request is too large to show as a QR (${encoder.fragmentsLength} frames). Try a smaller request.`,
    );
  }
  return encoder;
}

function uuidBytesToString(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The base64url signature from the Keystone's `arweave-signature` UR. A
 * signature that names another request id answers some other QR, so it's
 * refused; one without an id is accepted, and the background still
 * verifies it against the payload.
 */
export function decodeKeystoneSignature(ur: { type: string; cbor: Buffer }, expectedRequestId: string): string {
  if (ur.type !== KEYSTONE_SIGNATURE_UR_TYPE) {
    throw new KeystoneSignatureError("wrong-type", `Expected an "${KEYSTONE_SIGNATURE_UR_TYPE}" QR, got "${ur.type}".`);
  }
  const signature = ArweaveSignature.fromCBOR(ur.cbor);
  const requestId = signature.getRequestId();
  if (requestId && requestId.length > 0 && uuidBytesToString(requestId) !== expectedRequestId.toLowerCase()) {
    throw new KeystoneSignatureError("wrong-request", "That signature answers a different request.");
  }
  return bytesToBase64Url(signature.getSignature());
}
