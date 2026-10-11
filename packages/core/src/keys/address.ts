import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";

/**
 * Arweave address of an RSA public key given as its base64url modulus
 * (`n`). Kept free of arweave-js so the points server can use it, and so
 * a hardware wallet's address can be derived from the public key alone.
 */
export async function addressFromOwner(publicKeyModulus: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(publicKeyModulus));
  return bytesToBase64Url(new Uint8Array(digest));
}
