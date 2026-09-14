import { COMMON_PASSWORDS } from "./common-passwords";

const MIN_LENGTH = 10;

const COMMON_PASSWORD_SET = new Set(
  COMMON_PASSWORDS.map((password) => password.toLowerCase()),
);

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Password policy for vault encryption (CLAUDE.md "Vault / key storage
 * spec"): minimum 10 characters, rejected if it matches a common/breached
 * password. Callers must run this before `encryptToEnvelope` — the
 * envelope layer itself does not re-check policy, since re-encryption
 * (e.g. re-deriving on unlock) must never be blocked by a policy that
 * only applies at password-set time.
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < MIN_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MIN_LENGTH} characters.`,
    };
  }

  if (COMMON_PASSWORD_SET.has(password.toLowerCase())) {
    return {
      valid: false,
      reason: "That password is too common. Choose something less guessable.",
    };
  }

  return { valid: true };
}
