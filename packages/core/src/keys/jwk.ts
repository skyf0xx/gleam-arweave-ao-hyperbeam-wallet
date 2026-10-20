import { addressFromOwner } from "./address";
import type { JWKInterface } from "../models/wallet";

const REQUIRED_JWK_FIELDS = ["kty", "e", "n", "d", "p", "q", "dp", "dq", "qi"] as const;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

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
  const GENERIC_REASON = "That file isn't a valid Arweave keyfile.";

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, reason: GENERIC_REASON };
  }

  const candidate = input as Record<string, unknown>;

  for (const field of REQUIRED_JWK_FIELDS) {
    if (!(field in candidate)) {
      return {
        valid: false,
        reason: `${GENERIC_REASON} Missing required field "${field}".`,
      };
    }
  }

  if (candidate.kty !== "RSA") {
    return {
      valid: false,
      reason: `${GENERIC_REASON} Expected key type "RSA", got "${String(candidate.kty)}".`,
    };
  }

  for (const field of REQUIRED_JWK_FIELDS) {
    if (field === "kty") continue;
    const value = candidate[field];
    if (typeof value !== "string" || value.length === 0) {
      return {
        valid: false,
        reason: `${GENERIC_REASON} Field "${field}" must be a non-empty string.`,
      };
    }
    if (!BASE64URL_PATTERN.test(value)) {
      return {
        valid: false,
        reason: `${GENERIC_REASON} Field "${field}" is not valid base64url.`,
      };
    }
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
