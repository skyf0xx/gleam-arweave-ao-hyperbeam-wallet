import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";

export interface DevicePublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/**
 * RFC 7638 thumbprint of a device's P-256 public key: SHA-256 over the
 * required members in lexicographic order with no whitespace. The
 * register payload carries this instead of the whole key, and the server
 * recomputes it from the key it is sent.
 */
export async function deviceKeyThumbprint(jwk: DevicePublicJwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** Arweave address of an RSA public key given as its base64url modulus (`n`). */
export async function addressFromOwner(publicKeyModulus: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(publicKeyModulus));
  return bytesToBase64Url(new Uint8Array(digest));
}

const COORDINATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Shape check for a device public key arriving over the wire. */
export function isDevicePublicJwk(value: unknown): value is DevicePublicJwk {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kty === "EC" &&
    candidate.crv === "P-256" &&
    typeof candidate.x === "string" &&
    COORDINATE_PATTERN.test(candidate.x) &&
    typeof candidate.y === "string" &&
    COORDINATE_PATTERN.test(candidate.y)
  );
}

const DEVICE_SIGNATURE_PARAMS: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/** Signs a points payload with the install's device key; returns base64url. */
export async function signDeviceMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(DEVICE_SIGNATURE_PARAMS, privateKey, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyDeviceSignature(
  publicJwk: DevicePublicJwk,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      DEVICE_SIGNATURE_PARAMS,
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(message),
    );
  } catch {
    // A malformed key or signature is a failed verification, not a server error.
    return false;
  }
}
