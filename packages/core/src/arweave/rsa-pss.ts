import type { Signer } from "../vault/signer";

/**
 * Arweave's signature scheme: RSA-PSS over SHA-256 with a 32-byte salt,
 * the parameters arweave-js signs with and every Arweave signer
 * (keyfile, Keystone, Ledger) produces.
 */
const PSS_PARAMS = { name: "RSA-PSS", saltLength: 32 } as const;
const IMPORT_PARAMS = { name: "RSA-PSS", hash: "SHA-256" } as const;

type Bytes = Uint8Array<ArrayBuffer>;

export async function signRsaPss(signer: Signer, message: Bytes): Promise<Bytes> {
  return signer.signPss(message, { hash: IMPORT_PARAMS.hash, saltLength: PSS_PARAMS.saltLength });
}

/** Checks `signature` against the owner's base64url modulus. Arweave keys always use e = 65537. */
export async function verifyRsaPss(ownerB64Url: string, message: Bytes, signature: Bytes): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", e: "AQAB", n: ownerB64Url, ext: true },
      IMPORT_PARAMS,
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(PSS_PARAMS, key, signature, message);
  } catch {
    return false;
  }
}

export async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
