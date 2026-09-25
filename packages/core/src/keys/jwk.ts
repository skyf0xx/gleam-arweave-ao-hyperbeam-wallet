import Arweave from "arweave";
import type { JWKInterface } from "../models/wallet";

/**
 * A single, lazily-constructed Arweave client used only for its offline
 * JWK-generation and address-derivation helpers — neither touches the
 * network, so the gateway config passed to `init` is never dialed. Real
 * network reads use their own client, constructed with an explicit
 * gateway (`Arweave.init({})` silently falls back to `127.0.0.1:80`).
 * Built on first use rather than at module scope: `arweave-js`'s CJS
 * interop attaches `Arweave.init` to its default export as a side effect
 * of its own module evaluation, and calling `Arweave.init` from another
 * module's top level can race that assignment depending on bundler chunk
 * ordering.
 */
let arweave: ReturnType<typeof Arweave.init> | undefined;

function getArweave(): ReturnType<typeof Arweave.init> {
  arweave ??= Arweave.init({});
  return arweave;
}

const REQUIRED_JWK_FIELDS = ["kty", "e", "n", "d", "p", "q", "dp", "dq", "qi"] as const;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Generates a fresh RSA JWK keyfile. Callers are responsible for
 * encrypting the result into a `VaultEnvelope` before it touches any
 * storage — this function only produces plaintext key material.
 */
export async function generateJWK(): Promise<JWKInterface> {
  return getArweave().wallets.generate();
}

/**
 * Derives the Arweave address for a JWK. Deterministic: the same JWK
 * always yields the same address.
 */
export async function deriveAddress(jwk: JWKInterface): Promise<string> {
  return getArweave().wallets.jwkToAddress(jwk);
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
