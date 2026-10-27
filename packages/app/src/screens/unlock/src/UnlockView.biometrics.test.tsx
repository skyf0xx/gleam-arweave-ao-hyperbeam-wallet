import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import type { BiometricUnlockPort } from "../../../app-platform/types";
import { BiometricError } from "../../../biometrics/biometrics";
import { UnlockView } from "./UnlockView";

afterEach(() => {
  cleanup();
});

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

function renderUnlock(runtime: RuntimePort, biometrics: BiometricUnlockPort, onUnlocked = vi.fn()) {
  render(
    <UnlockView runtime={runtime} onUnlocked={onUnlocked} onResetComplete={vi.fn()} />,
    fakeAppPlatform({ capabilities: { biometrics: true, passkey: false }, biometrics }),
  );
  return onUnlocked;
}

const UNLOCKED = () => ({ unlockedWalletIds: ["wallet-1"] });
const WRONG_PASSWORD = () => {
  throw new Error("That password didn't work.");
};

describe("UnlockView with biometric unlock", () => {
  it("opens straight to the OS prompt and unlocks with the password it released", async () => {
    const unlockWallet = vi.fn(UNLOCKED);
    const biometrics = biometricPort();
    const onUnlocked = renderUnlock(runtimeWith({ getSecurityPhrase: () => null, unlockWallet }), biometrics);

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(biometrics.readPassword).toHaveBeenCalledOnce();
    expect(unlockWallet).toHaveBeenCalledWith({ password: "correct horse" });
  });

  it("names the button for what the device offers, with the password one tap away", async () => {
    const biometrics = biometricPort({
      availability: vi.fn(async () => ({ available: true, kind: "fingerprint" }) as const),
      readPassword: vi.fn(async () => {
        throw new BiometricError("cancelled", "User canceled");
      }),
    });
    renderUnlock(runtimeWith({ getSecurityPhrase: () => null }), biometrics);

    expect(await screen.findByRole("button", { name: "Unlock with fingerprint" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use password instead" }));
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use fingerprint" }));
    expect(screen.getByRole("button", { name: "Unlock with fingerprint" })).toBeTruthy();
  });

  it("treats a dismissed prompt as a cancel and tries again on tap", async () => {
    const readPassword = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new BiometricError("cancelled", "User canceled"))
      .mockResolvedValueOnce("correct horse");
    const biometrics = biometricPort({ readPassword });
    const onUnlocked = renderUnlock(runtimeWith({ getSecurityPhrase: () => null, unlockWallet: UNLOCKED }), biometrics);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Face ID cancelled/));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onUnlocked).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Unlock with Face ID" }));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
  });

  it("keeps the password form when nothing is stored", async () => {
    const biometrics = biometricPort({ isEnrolled: vi.fn(async () => false) });
    const runtime = runtimeWith({ getSecurityPhrase: () => null });
    renderUnlock(runtime, biometrics);

    await waitFor(() => expect(biometrics.isEnrolled).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unlock with face id/i })).toBeNull();
    expect(biometrics.readPassword).not.toHaveBeenCalled();
  });

  it("keeps the password form when the device can't check biometrics right now", async () => {
    const biometrics = biometricPort({
      availability: vi.fn(async () => ({ available: false, reason: "not-enrolled" }) as const),
    });
    renderUnlock(runtimeWith({ getSecurityPhrase: () => null }), biometrics);

    await waitFor(() => expect(biometrics.availability).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(biometrics.readPassword).not.toHaveBeenCalled();
  });

  it("drops a stored password that no longer opens the vault", async () => {
    const biometrics = biometricPort();
    renderUnlock(
      runtimeWith({ getSecurityPhrase: () => null, unlockWallet: WRONG_PASSWORD, probeVaultPassword: () => ({ opens: false }) }),
      biometrics,
    );

    await waitFor(() => expect(biometrics.remove).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Face ID no longer matches your password/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock with Face ID" })).toBeNull();
  });

  it("keeps the stored password when the unlock fails for another reason", async () => {
    const biometrics = biometricPort();
    renderUnlock(
      runtimeWith({
        getSecurityPhrase: () => null,
        unlockWallet: () => {
          throw new Error("Storage is unavailable.");
        },
        probeVaultPassword: () => ({ opens: true }),
      }),
      biometrics,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Storage is unavailable/));
    expect(biometrics.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Unlock with Face ID" })).toBeTruthy();
  });

  it("keeps the stored password when the vault check itself couldn't run", async () => {
    const biometrics = biometricPort();
    renderUnlock(
      runtimeWith({
        getSecurityPhrase: () => null,
        unlockWallet: () => {
          throw new Error("Gleam couldn't run its password check.");
        },
        probeVaultPassword: () => {
          throw new Error("Gleam couldn't run its password check.");
        },
      }),
      biometrics,
    );

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't run its password check/));
    expect(biometrics.remove).not.toHaveBeenCalled();
    expect(screen.queryByText(/no longer matches/)).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock with Face ID" })).toBeTruthy();
  });

  it("falls back to the password once the OS discarded it after a biometrics change", async () => {
    const biometrics = biometricPort({
      readPassword: vi.fn(async () => {
        throw new BiometricError("invalidated", "No protected credentials found");
      }),
    });
    renderUnlock(runtimeWith({ getSecurityPhrase: () => null }), biometrics);

    expect(await screen.findByText(/Face ID settings changed/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock with Face ID" })).toBeNull();
  });

  it("skips the auto-prompt when a typed password is already unlocking", async () => {
    let enrolled!: (value: boolean) => void;
    let unlocked!: (value: unknown) => void;
    const biometrics = biometricPort({ isEnrolled: vi.fn(() => new Promise<boolean>((resolve) => (enrolled = resolve))) });
    const unlockWallet = vi.fn(() => new Promise((resolve) => (unlocked = resolve)));
    const onUnlocked = renderUnlock(runtimeWith({ getSecurityPhrase: () => null, unlockWallet }), biometrics);

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(unlockWallet).toHaveBeenCalledOnce());

    enrolled(true);
    const button = await screen.findByRole("button", { name: "Unlock with Face ID" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(biometrics.readPassword).not.toHaveBeenCalled();

    unlocked(UNLOCKED());
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(biometrics.readPassword).not.toHaveBeenCalled();
  });

  it("keeps the password way in disabled while the OS prompt is up", async () => {
    let released!: (password: string) => void;
    const biometrics = biometricPort({ readPassword: vi.fn(() => new Promise<string>((resolve) => (released = resolve))) });
    const unlockWallet = vi.fn(UNLOCKED);
    const onUnlocked = renderUnlock(runtimeWith({ getSecurityPhrase: () => null, unlockWallet }), biometrics);

    await waitFor(() => expect(biometrics.readPassword).toHaveBeenCalledOnce());
    expect((screen.getByRole("button", { name: "Use password instead" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Forgot password?" }) as HTMLButtonElement).disabled).toBe(true);

    released("correct horse");
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(unlockWallet).toHaveBeenCalledOnce();
  });

  it("never asks the OS when the shell has no biometrics", async () => {
    const biometrics = biometricPort();
    const runtime = runtimeWith({ getSecurityPhrase: () => null, getPasskeyStatus: () => ({ enrolled: false }) });
    render(
      <UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />,
      fakeAppPlatform({ biometrics }),
    );

    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith({ type: "getPasskeyStatus", payload: undefined }));
    expect(biometrics.availability).not.toHaveBeenCalled();
    expect(biometrics.isEnrolled).not.toHaveBeenCalled();
  });
});
