import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessControl, BiometricAuthError, BiometryType } from "@capgo/capacitor-native-biometric";
import { BiometricError } from "@gleam/app/src/biometrics/biometrics.ts";
import { createBiometricUnlock } from "./biometric-unlock";

const plugin = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  isCredentialsSaved: vi.fn(),
  setCredentials: vi.fn(),
  getSecureCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  getCredentials: vi.fn(),
  verifyIdentity: vi.fn(),
}));

vi.mock("@capgo/capacitor-native-biometric", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capgo/capacitor-native-biometric")>()),
  NativeBiometric: plugin,
}));

/** What Capacitor rejects with: the native code as a string. */
function nativeError(code: BiometricAuthError | 0, message = "native error"): Error {
  return Object.assign(new Error(message), { code: String(code) });
}

function available(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: true,
    strongBiometryIsAvailable: true,
    authenticationStrength: 1,
    biometryType: BiometryType.FACE_ID,
    deviceIsSecure: true,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<BiometricError> {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BiometricError);
  return error as BiometricError;
}

beforeEach(() => {
  for (const fn of Object.values(plugin)) fn.mockReset();
  plugin.deleteCredentials.mockResolvedValue(undefined);
  plugin.isCredentialsSaved.mockResolvedValue({ isSaved: true });
});

describe("biometric unlock adapter", () => {
  it("stores the password behind the current biometrics, released per read", async () => {
    plugin.setCredentials.mockResolvedValue(undefined);
    await createBiometricUnlock().enrol("correct horse");

    expect(plugin.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "correct horse",
        accessControl: AccessControl.BIOMETRY_CURRENT_SET,
        authValidityDuration: 0,
      }),
    );
  });

  it("reads the password only through the OS-gated call", async () => {
    plugin.getSecureCredentials.mockResolvedValue({ username: "gleam", password: "correct horse" });
    await expect(createBiometricUnlock().readPassword()).resolves.toBe("correct horse");

    const server = plugin.getSecureCredentials.mock.calls[0]?.[0]?.server;
    expect(server).toEqual(expect.any(String));
    expect(plugin.getCredentials).not.toHaveBeenCalled();
    expect(plugin.verifyIdentity).not.toHaveBeenCalled();
  });

  it("uses one server for store, read, check and delete", async () => {
    plugin.setCredentials.mockResolvedValue(undefined);
    plugin.getSecureCredentials.mockResolvedValue({ username: "gleam", password: "pw" });
    const port = createBiometricUnlock();
    await port.enrol("pw");
    await port.readPassword();
    await port.isEnrolled();
    await port.remove();

    const servers = new Set(
      [plugin.setCredentials, plugin.getSecureCredentials, plugin.isCredentialsSaved, plugin.deleteCredentials].map(
        (fn) => fn.mock.calls[0]?.[0]?.server,
      ),
    );
    expect(servers.size).toBe(1);
  });

  it.each([
    [BiometryType.FACE_ID, "faceId"],
    [BiometryType.TOUCH_ID, "touchId"],
    [BiometryType.FINGERPRINT, "fingerprint"],
    [BiometryType.FACE_AUTHENTICATION, "face"],
    [BiometryType.IRIS_AUTHENTICATION, "iris"],
    [BiometryType.MULTIPLE, "biometrics"],
  ])("names biometry type %s as %s", async (biometryType, kind) => {
    plugin.isAvailable.mockResolvedValue(available({ biometryType }));
    await expect(createBiometricUnlock().availability()).resolves.toEqual({ available: true, kind });
    expect(plugin.isAvailable).toHaveBeenCalledWith({ useFallback: false });
  });

  it("counts only strong biometrics, which the Keystore can bind a key to", async () => {
    plugin.isAvailable.mockResolvedValue(available({ strongBiometryIsAvailable: false, authenticationStrength: 2 }));
    await expect(createBiometricUnlock().availability()).resolves.toEqual({ available: false, reason: "unavailable" });
  });

  it("tells a device with nothing enrolled from one with no passcode", async () => {
    plugin.isAvailable.mockResolvedValueOnce(
      available({ isAvailable: false, strongBiometryIsAvailable: false, errorCode: BiometricAuthError.BIOMETRICS_NOT_ENROLLED }),
    );
    plugin.isAvailable.mockResolvedValueOnce(
      available({
        isAvailable: false,
        strongBiometryIsAvailable: false,
        deviceIsSecure: false,
        errorCode: BiometricAuthError.PASSCODE_NOT_SET,
      }),
    );
    const port = createBiometricUnlock();
    await expect(port.availability()).resolves.toEqual({ available: false, reason: "not-enrolled" });
    await expect(port.availability()).resolves.toEqual({ available: false, reason: "no-passcode" });
  });

  it.each([
    [BiometricAuthError.USER_CANCEL, "cancelled"],
    [BiometricAuthError.SYSTEM_CANCEL, "cancelled"],
    [BiometricAuthError.USER_FALLBACK, "cancelled"],
    [BiometricAuthError.AUTHENTICATION_FAILED, "failed"],
    [BiometricAuthError.USER_LOCKOUT, "lockout"],
    [BiometricAuthError.USER_TEMPORARY_LOCKOUT, "lockout"],
  ])("reports read error %s as %s and keeps the stored password", async (code, reason) => {
    plugin.getSecureCredentials.mockRejectedValue(nativeError(code));
    expect((await rejection(createBiometricUnlock().readPassword())).reason).toBe(reason);
    expect(plugin.deleteCredentials).not.toHaveBeenCalled();
  });

  it("reports a password the OS discarded after a biometrics change, and clears what is left", async () => {
    plugin.getSecureCredentials.mockRejectedValue(nativeError(BiometricAuthError.NO_PROTECTED_CREDENTIALS_FOUND));
    expect((await rejection(createBiometricUnlock().readPassword())).reason).toBe("invalidated");
    expect(plugin.deleteCredentials).toHaveBeenCalledTimes(1);
  });

  it("treats a generic read failure that left nothing stored as invalidated", async () => {
    // Android deletes the data, then rejects with code 0, when the Keystore key was invalidated.
    plugin.getSecureCredentials.mockRejectedValue(nativeError(0, "Biometric crypto object unavailable"));
    plugin.isCredentialsSaved.mockResolvedValue({ isSaved: false });
    expect((await rejection(createBiometricUnlock().readPassword())).reason).toBe("invalidated");
    expect(plugin.deleteCredentials).toHaveBeenCalledTimes(1);
  });

  it("keeps the password through a generic read failure while it is still stored", async () => {
    plugin.getSecureCredentials.mockRejectedValue(nativeError(0));
    expect((await rejection(createBiometricUnlock().readPassword())).reason).toBe("unknown");
    expect(plugin.deleteCredentials).not.toHaveBeenCalled();
  });

  it("reports a cancelled enrolment prompt", async () => {
    plugin.setCredentials.mockRejectedValue(nativeError(BiometricAuthError.USER_CANCEL));
    expect((await rejection(createBiometricUnlock().enrol("pw"))).reason).toBe("cancelled");
  });

  it("asks whether a password is stored without a prompt", async () => {
    plugin.isCredentialsSaved.mockResolvedValue({ isSaved: false });
    await expect(createBiometricUnlock().isEnrolled()).resolves.toBe(false);
    expect(plugin.getSecureCredentials).not.toHaveBeenCalled();
  });
});
