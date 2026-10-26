import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LockSettings, RuntimePort } from "@gleam/core";
import type { BiometricUnlockPort } from "../../../app-platform/types";
import { BiometricError } from "../../../biometrics/biometrics";
import { LockSettingsView } from "./LockSettingsView";

afterEach(() => {
  cleanup();
});

const NEVER: LockSettings = { autoLockTimeout: "never" };

function runtimeWith(checkVaultPassword: (payload: unknown) => unknown = () => undefined) {
  const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
    if (type === "getLockSettings") return NEVER;
    if (type === "getSecurityPhrase") return null;
    if (type === "checkVaultPassword") return checkVaultPassword(payload);
    throw new Error(`unexpected ${type}`);
  });
  return { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort & { send: ReturnType<typeof vi.fn> };
}

function biometricPort(overrides: Partial<BiometricUnlockPort> = {}) {
  return {
    availability: vi.fn(async () => ({ available: true, kind: "faceId" }) as const),
    isEnrolled: vi.fn(async () => false),
    enrol: vi.fn(async () => {}),
    readPassword: vi.fn(async () => "unused"),
    remove: vi.fn(async () => {}),
    ...overrides,
  } satisfies BiometricUnlockPort;
}

function renderSettings(runtime: RuntimePort, biometrics?: BiometricUnlockPort) {
  render(<LockSettingsView runtime={runtime} onBack={vi.fn()} onLocked={vi.fn()} biometrics={biometrics} />);
}

function submitPassword(password: string) {
  fireEvent.change(screen.getByPlaceholderText("Enter your Gleam password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
}

describe("LockSettingsView biometric section", () => {
  it("checks the password, then stores it behind Face ID", async () => {
    const runtime = runtimeWith();
    const biometrics = biometricPort();
    renderSettings(runtime, biometrics);

    fireEvent.click(await screen.findByRole("button", { name: /Unlock with Face ID/ }));
    submitPassword("correct horse");

    expect(await screen.findByText("Unlock with Face ID is on")).toBeTruthy();
    expect(runtime.send).toHaveBeenCalledWith({ type: "checkVaultPassword", payload: { password: "correct horse" } });
    expect(biometrics.enrol).toHaveBeenCalledExactlyOnceWith("correct horse");
  });

  it("never stores a password that doesn't open the vault", async () => {
    const biometrics = biometricPort();
    renderSettings(
      runtimeWith(() => {
        throw new Error("That password didn't work. Use the password you unlock Gleam with.");
      }),
      biometrics,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Unlock with Face ID/ }));
    submitPassword("typo");

    expect(await screen.findByText(/That password didn't work/)).toBeTruthy();
    expect(biometrics.enrol).not.toHaveBeenCalled();
  });

  it("treats a dismissed enrolment prompt as a cancel", async () => {
    const biometrics = biometricPort({
      enrol: vi.fn(async () => {
        throw new BiometricError("cancelled", "User canceled");
      }),
    });
    renderSettings(runtimeWith(), biometrics);

    fireEvent.click(await screen.findByRole("button", { name: /Unlock with Face ID/ }));
    submitPassword("correct horse");

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Face ID cancelled/));
    expect(screen.queryByText("Unlock with Face ID is on")).toBeNull();
  });

  it("turns off a stored password", async () => {
    const biometrics = biometricPort({ isEnrolled: vi.fn(async () => true) });
    renderSettings(runtimeWith(), biometrics);

    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(biometrics.remove).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: /Unlock with Face ID/ })).toBeTruthy();
  });

  it("points to the device settings when no biometrics are enrolled", async () => {
    const biometrics = biometricPort({
      availability: vi.fn(async () => ({ available: false, reason: "not-enrolled" }) as const),
    });
    renderSettings(runtimeWith(), biometrics);

    expect(await screen.findByText(/in your device settings/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Unlock with/ })).toBeNull();
  });

  it("still turns off a stored password when the device can't check biometrics", async () => {
    const biometrics = biometricPort({
      availability: vi.fn(async () => ({ available: false, reason: "not-enrolled" }) as const),
      isEnrolled: vi.fn(async () => true),
    });
    renderSettings(runtimeWith(), biometrics);

    expect(await screen.findByText(/can't check biometrics right now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(biometrics.remove).toHaveBeenCalledOnce());
    expect(await screen.findByText(/in your device settings/)).toBeTruthy();
  });

  it("is hidden without a biometric port", async () => {
    renderSettings(runtimeWith());
    await screen.findByText("Never");
    expect(screen.queryByText("Biometrics")).toBeNull();
    expect(screen.queryByText(/Face ID/)).toBeNull();
  });
});
