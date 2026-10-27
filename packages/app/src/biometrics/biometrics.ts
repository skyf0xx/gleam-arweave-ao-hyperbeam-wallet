import type { RuntimePort } from "@gleam/core";
import type { BiometricUnlockPort, BiometryKind } from "../app-platform/types";

/**
 * - `invalidated`: the device's biometrics changed, so the OS discarded the
 *   stored password.
 * - `mismatch`: the stored password no longer opens the vault.
 */
export type BiometricErrorReason =
  | "cancelled"
  | "failed"
  | "lockout"
  | "invalidated"
  | "mismatch"
  | "unavailable"
  | "unknown";

export class BiometricError extends Error {
  constructor(
    readonly reason: BiometricErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "BiometricError";
  }
}

const LABELS: Record<BiometryKind, string> = {
  faceId: "Face ID",
  touchId: "Touch ID",
  fingerprint: "fingerprint",
  face: "face recognition",
  iris: "iris scan",
  biometrics: "biometrics",
};

/** The name to use mid-sentence: "Unlock with Face ID", "Unlock with fingerprint". */
export function biometryLabel(kind: BiometryKind): string {
  return LABELS[kind];
}

/** The name to start a heading or sentence with. */
export function biometryTitle(kind: BiometryKind): string {
  const label = LABELS[kind];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Asks the OS for the stored password, then unlocks with it as the
 * password form does.
 */
export async function unlockWithBiometrics(
  runtime: RuntimePort,
  biometrics: BiometricUnlockPort,
  kind: BiometryKind,
): Promise<{ unlockedWalletIds: string[] }> {
  const password = await biometrics.readPassword();
  try {
    return await runtime.send<{ password: string }, { unlockedWalletIds: string[] }>({
      type: "unlockWallet",
      payload: { password },
    });
  } catch (error) {
    // Only a definite "doesn't open" drops the stored password. A check
    // that couldn't run says nothing about it, so the unlock error stands.
    const probe = await runtime
      .send<{ password: string }, { opens: boolean }>({ type: "probeVaultPassword", payload: { password } })
      .catch(() => null);
    if (probe?.opens !== false) throw error;
    // Every wallet the stored password protected was removed and a new
    // password set. Keeping it would fail the same way on every unlock.
    await biometrics.remove().catch(() => {});
    throw new BiometricError(
      "mismatch",
      `${biometryTitle(kind)} no longer matches your password. Unlock with your password, then turn ${biometryLabel(kind)} on again.`,
    );
  }
}

/** Errors that leave nothing stored, so the biometric option goes away. */
export function biometricsGone(error: unknown): boolean {
  return error instanceof BiometricError && (error.reason === "invalidated" || error.reason === "mismatch");
}

export function biometricNotice(error: unknown, kind: BiometryKind): { text: string; tone: "muted" | "error" } {
  const label = biometryLabel(kind);
  const title = biometryTitle(kind);
  if (!(error instanceof BiometricError)) {
    return { text: error instanceof Error ? error.message : String(error), tone: "error" };
  }
  switch (error.reason) {
    case "cancelled":
      return { text: `${title} cancelled. Try again, or use your password.`, tone: "muted" };
    case "failed":
      return { text: `${title} didn't work. Try again, or use your password.`, tone: "error" };
    case "lockout":
      return { text: `Too many tries. Unlock with your password.`, tone: "error" };
    case "invalidated":
      return {
        text: `Your device's ${label} settings changed, so Gleam turned ${label} unlock off. Unlock with your password, then turn it on again.`,
        tone: "error",
      };
    case "unavailable":
      return { text: `${title} isn't available right now. Use your password.`, tone: "error" };
    default:
      return { text: error.message, tone: "error" };
  }
}
