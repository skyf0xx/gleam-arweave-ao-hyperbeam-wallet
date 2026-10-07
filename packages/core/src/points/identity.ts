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
