/**
 * A passkey enrolled to unlock Gleam. The passkey's WebAuthn PRF output
 * wraps the vault password, so a passkey unlock runs the same unlock as
 * typing the password. `credentialId` and `prfSalt` are not secret: they
 * tell the authenticator which passkey to use and what to evaluate.
 */
export interface PasskeyEnrollment {
  version: 1;
  /** Base64url WebAuthn credential id. */
  credentialId: string;
  /** Base64url PRF input, 32 random bytes. */
  prfSalt: string;
  /** Base64 AES-GCM IV. */
  iv: string;
  /** Base64 AES-GCM ciphertext of the vault password. */
  ciphertext: string;
  createdAt: number;
}

export function isPasskeyEnrollment(value: unknown): value is PasskeyEnrollment {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.credentialId === "string" &&
    candidate.credentialId.length > 0 &&
    typeof candidate.prfSalt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string" &&
    typeof candidate.createdAt === "number"
  );
}

/** What the UI needs to run a passkey ceremony. Never carries the wrapped password. */
export type PasskeyStatus =
  | { enrolled: false }
  | { enrolled: true; credentialId: string; prfSalt: string; createdAt: number };
