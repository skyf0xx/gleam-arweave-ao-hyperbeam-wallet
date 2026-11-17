import { describe, expect, it, vi } from "vitest";
import type { RuntimePort } from "@gleam/core";
import type { BiometricUnlockPort } from "../app-platform/types";
import { BiometricError, unlockWithBiometrics } from "./biometrics";

function runtimeWith(handlers: Record<string, (payload: unknown) => unknown>): RuntimePort & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
    const handler = handlers[type];
    if (!handler) throw new Error(`unexpected ${type}`);
    return handler(payload);
  });
  return { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort & { send: ReturnType<typeof vi.fn> };
}

function biometricPort(overrides: Partial<BiometricUnlockPort> = {}) {
  return {
    availability: vi.fn(async () => ({ available: true, kind: "faceId" }) as const),
    isEnrolled: vi.fn(async () => true),
    enrol: vi.fn(async () => {}),
    readPassword: vi.fn(async () => "correct horse"),
    remove: vi.fn(async () => {}),
    ...overrides,
  } satisfies BiometricUnlockPort;
}

const WRONG_PASSWORD = () => {
  throw new Error("That password didn't work.");
};

describe("unlockWithBiometrics", () => {
  it("drops the stored password only when the probe says it no longer opens the vault", async () => {
    const biometrics = biometricPort();
    const runtime = runtimeWith({
      unlockWallet: WRONG_PASSWORD,
      probeVaultPassword: () => ({ opens: false }),
    });

    const error = await unlockWithBiometrics(runtime, biometrics, "faceId").catch((caught) => caught);

    expect(error).toBeInstanceOf(BiometricError);
    expect((error as BiometricError).reason).toBe("mismatch");
    expect(biometrics.remove).toHaveBeenCalledOnce();
  });

  it("keeps the stored password when the probe cannot run", async () => {
    const biometrics = biometricPort();
    const runtime = runtimeWith({
      unlockWallet: WRONG_PASSWORD,
      probeVaultPassword: () => {
        throw new Error("probe failed");
      },
    });

    const error = await unlockWithBiometrics(runtime, biometrics, "faceId").catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("That password didn't work.");
    expect(biometrics.remove).not.toHaveBeenCalled();
  });

  it("keeps the stored password when the probe says it still opens the vault", async () => {
    const biometrics = biometricPort();
    const runtime = runtimeWith({
      unlockWallet: WRONG_PASSWORD,
      probeVaultPassword: () => ({ opens: true }),
    });

    const error = await unlockWithBiometrics(runtime, biometrics, "faceId").catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("That password didn't work.");
    expect(biometrics.remove).not.toHaveBeenCalled();
  });
});
