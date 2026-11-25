import { addressFromOwner } from "./address";
import type { JWKInterface } from "../models/wallet";
import { userErrorMessage } from "../models/user-errors";
import { base64UrlToBytes } from "../vault/base64";
import { isPlainRecord } from "../models/guards";

const REQUIRED_JWK_FIELDS = ["kty", "e", "n", "d", "p", "q", "dp", "dq", "qi"] as const;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Arweave keys are RSA-4096 with the public exponent 65537. */
const ARWEAVE_MODULUS_BYTES = 512;
/** Unpadded base64url length of 512 bytes. */
const ARWEAVE_MODULUS_CHARS = 683;
const ARWEAVE_PUBLIC_EXPONENT = "AQAB";

/** True when `n` decodes to exactly 4096 bits: 512 bytes with the top bit set. */
function isArweaveModulus(n: string): boolean {
  if (n.length !== ARWEAVE_MODULUS_CHARS) return false;
  const bytes = base64UrlToBytes(n);
  return bytes.length === ARWEAVE_MODULUS_BYTES && (bytes[0]! & 0x80) !== 0;
}

/**
 * Derives the Arweave address for a JWK. Deterministic: the same JWK
 * always yields the same address.
 */
export async function deriveAddress(jwk: JWKInterface): Promise<string> {
  return addressFromOwner(jwk.n);
}

export type JWKValidationResult =
  | { valid: true; jwk: JWKInterface }
  | { valid: false; reason: string };

/**
 * Validates that `input` (typically `JSON.parse`d from an imported
 * keyfile) has the shape of an RSA Arweave JWK, returning a specific
 * rejection reason rather than a generic error.
 */
export function validateJWKShape(input: unknown): JWKValidationResult {
  if (!isPlainRecord(input)) {
    return { valid: false, reason: userErrorMessage("keyfileInvalid") };
  }

  const candidate = input;

  for (const field of REQUIRED_JWK_FIELDS) {
    if (!(field in candidate)) {
      return {
        valid: false,
        reason: userErrorMessage("keyfileMissingField", { key: field }),
      };
    }
  }

  if (candidate.kty !== "RSA") {
    return {
      valid: false,
      reason: userErrorMessage("keyfileWrongKeyType", { kty: String(candidate.kty) }),
    };
  }

  for (const field of REQUIRED_JWK_FIELDS) {
    if (field === "kty") continue;
    const value = candidate[field];
    if (typeof value !== "string" || value.length === 0) {
      return {
        valid: false,
        reason: userErrorMessage("keyfileEmptyField", { key: field }),
      };
    }
    if (!BASE64URL_PATTERN.test(value)) {
      return {
        valid: false,
        reason: userErrorMessage("keyfileBadField", { key: field }),
      };
    }
  }

  if (candidate.e !== ARWEAVE_PUBLIC_EXPONENT || !isArweaveModulus(candidate.n as string)) {
    return { valid: false, reason: userErrorMessage("keyfileUnsupportedSize") };
  }

  return {
    valid: true,
    jwk: {
      kty: candidate.kty as string,
      e: candidate.e as string,
      n: candidate.n as string,
      d: candidate.d as string,
      p: candidate.p as string,
      q: candidate.q as string,
      dp: candidate.dp as string,
      dq: candidate.dq as string,
      qi: candidate.qi as string,
    },
  };
}
