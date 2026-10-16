import { base64ToBytes, bytesToBase64 } from "./base64";
import { zeroize } from "../signer/zeroize";

const IV_LENGTH_BYTES = 12;
const HKDF_INFO = new TextEncoder().encode("gleam:passkey:v1");

/** The WebAuthn PRF extension returns 32 bytes. Anything else is not a PRF output. */
export const PRF_OUTPUT_LENGTH_BYTES = 32;

/** Binds the ciphertext to the credential that produced its key. */
function buildAAD(credentialId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gleam:passkey:v1:${credentialId}`);
}

/**
 * HKDF rather than using the PRF output as the AES key directly, so the
 * same passkey's PRF output can never be reused as-is for anything else.
 */
async function deriveWrappingKey(prfOutput: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (prfOutput.length !== PRF_OUTPUT_LENGTH_BYTES) {
    throw new Error("The passkey returned an unexpected secret.");
  }
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapWithPasskey(
  secret: string,
  prfOutput: Uint8Array<ArrayBuffer>,
  credentialId: string,
): Promise<{ iv: string; ciphertext: string }> {
  const plaintext = new TextEncoder().encode(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  try {
    const key = await deriveWrappingKey(prfOutput);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildAAD(credentialId) },
      key,
      plaintext,
    );
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  } finally {
    zeroize(plaintext);
  }
}

export async function unwrapWithPasskey(
  wrapped: { iv: string; ciphertext: string },
  prfOutput: Uint8Array<ArrayBuffer>,
  credentialId: string,
): Promise<string> {
  const key = await deriveWrappingKey(prfOutput);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(wrapped.iv), additionalData: buildAAD(credentialId) },
      key,
      base64ToBytes(wrapped.ciphertext),
    );
  } catch {
    throw new Error("That passkey didn't unlock Gleam. Use your password instead.");
  }
  const bytes = new Uint8Array(plaintext);
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    zeroize(bytes);
  }
}
