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

/** What the UI needs to run a passkey ceremony. Never carries the wrapped password. */
export type PasskeyStatus =
  | { enrolled: false }
  | { enrolled: true; credentialId: string; prfSalt: string; createdAt: number };
