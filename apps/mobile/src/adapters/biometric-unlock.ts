import {
  AccessControl,
  BiometricAuthError,
  BiometryType,
  NativeBiometric,
} from "@capgo/capacitor-native-biometric";
import { BiometricError, type BiometricErrorReason } from "@gleam/app/src/biometrics/biometrics.ts";
import type {
  BiometricAvailability,
  BiometricUnlockPort,
  BiometryKind,
} from "@gleam/app/src/app-platform/types.ts";

/**
 * Every call into the biometric plugin. The vault password is stored only
 * with `setCredentials` under `BIOMETRY_CURRENT_SET` and read only with
 * `getSecureCredentials`: the OS hands it over after its own biometric
 * check (Keychain access control on iOS, a Keystore key bound to a
 * `BiometricPrompt` `CryptoObject` on Android), and discards it when the
 * enrolled biometrics change. `getCredentials` would skip that check and
 * `verifyIdentity` only reports a boolean, so neither is used.
 */
const SERVER = "app.gleamwallet.vault-password";
const USERNAME = "gleam";
const PROMPT_TITLE = "Unlock Gleam";
// The plugin's Android default of one try ends the prompt on a single
// misread finger; five is the most BiometricPrompt allows.
const MAX_ATTEMPTS = 5;

const KINDS: Partial<Record<BiometryType, BiometryKind>> = {
  [BiometryType.FACE_ID]: "faceId",
  [BiometryType.TOUCH_ID]: "touchId",
  [BiometryType.FINGERPRINT]: "fingerprint",
  [BiometryType.FACE_AUTHENTICATION]: "face",
  [BiometryType.IRIS_AUTHENTICATION]: "iris",
};

const REASONS: Partial<Record<BiometricAuthError, BiometricErrorReason>> = {
  [BiometricAuthError.USER_CANCEL]: "cancelled",
  [BiometricAuthError.SYSTEM_CANCEL]: "cancelled",
  [BiometricAuthError.APP_CANCEL]: "cancelled",
  [BiometricAuthError.USER_FALLBACK]: "cancelled",
  [BiometricAuthError.AUTHENTICATION_FAILED]: "failed",
  [BiometricAuthError.USER_LOCKOUT]: "lockout",
  [BiometricAuthError.USER_TEMPORARY_LOCKOUT]: "lockout",
  [BiometricAuthError.BIOMETRICS_UNAVAILABLE]: "unavailable",
  [BiometricAuthError.BIOMETRICS_NOT_ENROLLED]: "unavailable",
  [BiometricAuthError.PASSCODE_NOT_SET]: "unavailable",
  [BiometricAuthError.NO_PROTECTED_CREDENTIALS_FOUND]: "invalidated",
};

/** Capacitor rejects with the native code as a string. */
function reasonFor(error: unknown): BiometricErrorReason {
  const code = Number((error as { code?: unknown } | null)?.code);
  return (Number.isInteger(code) ? REASONS[code as BiometricAuthError] : undefined) ?? "unknown";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isSaved(): Promise<boolean> {
  return (await NativeBiometric.isCredentialsSaved({ server: SERVER })).isSaved;
}

async function remove(): Promise<void> {
  await NativeBiometric.deleteCredentials({ server: SERVER });
}

export function createBiometricUnlock(): BiometricUnlockPort {
  return {
    async availability(): Promise<BiometricAvailability> {
      const result = await NativeBiometric.isAvailable({ useFallback: false });
      // The Android Keystore binds the key to a CryptoObject, which only
      // strong (Class 3) biometrics can release.
      if (result.isAvailable && result.strongBiometryIsAvailable) {
        return { available: true, kind: KINDS[result.biometryType] ?? "biometrics" };
      }
      if (result.errorCode === BiometricAuthError.BIOMETRICS_NOT_ENROLLED) return { available: false, reason: "not-enrolled" };
      if (result.errorCode === BiometricAuthError.PASSCODE_NOT_SET || !result.deviceIsSecure) {
        return { available: false, reason: "no-passcode" };
      }
      return { available: false, reason: "unavailable" };
    },

    isEnrolled: isSaved,

    async enrol(password) {
      try {
        await NativeBiometric.setCredentials({
          server: SERVER,
          username: USERNAME,
          password,
          accessControl: AccessControl.BIOMETRY_CURRENT_SET,
          authValidityDuration: 0,
          title: "Turn on biometric unlock",
          maxAttempts: MAX_ATTEMPTS,
        });
      } catch (error) {
        throw new BiometricError(reasonFor(error), messageOf(error));
      }
    },

    async readPassword() {
      try {
        const { password } = await NativeBiometric.getSecureCredentials({
          server: SERVER,
          reason: PROMPT_TITLE,
          title: PROMPT_TITLE,
          maxAttempts: MAX_ATTEMPTS,
        });
        return password;
      } catch (error) {
        let reason = reasonFor(error);
        // Android reports a key invalidated by new biometrics as a generic
        // failure, after deleting what it stored.
        if (reason === "unknown" && !(await isSaved().catch(() => true))) reason = "invalidated";
        if (reason === "invalidated") await remove().catch(() => {});
        throw new BiometricError(reason, messageOf(error));
      }
    },

    remove,
  };
}
