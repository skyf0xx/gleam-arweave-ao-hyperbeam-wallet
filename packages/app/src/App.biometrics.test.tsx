import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import type { BiometricUnlockPort } from "./app-platform/types";
import App from "./App";

afterEach(() => {
  cleanup();
});

function wallet(method: WalletSummary["method"]): WalletSummary {
  return { id: `w-${method}`, address: "addr", name: "Main", method, publicKey: "pk", createdAt: 0, updatedAt: 0, backupConfirmedAt: null };
}

function runtimeFor(state: WalletState): RuntimePort {
  return {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return state;
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "getPasskeyStatus") return { enrolled: false };
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
}

function biometricPort() {
  return {
    availability: vi.fn(async () => ({ available: false, reason: "unavailable" }) as const),
    isEnrolled: vi.fn(async () => false),
    enrol: vi.fn(async () => {}),
    readPassword: vi.fn(async () => ""),
    remove: vi.fn(async () => {}),
  } satisfies BiometricUnlockPort;
}

async function mount(state: WalletState, biometrics: BiometricUnlockPort, capabilities = { biometrics: true }) {
  await act(async () => {
    render(<App layout="phone" />, fakeAppPlatform({ runtime: runtimeFor(state), biometrics, capabilities }));
  });
}

describe("App biometric enrolment lifecycle", () => {
  it("drops the stored password when the vault has none, as after an uninstall", async () => {
    const biometrics = biometricPort();
    await mount({ wallets: [], activeWalletId: null, session: null }, biometrics);
    expect(biometrics.remove).toHaveBeenCalledOnce();
  });

  it("drops it when only hardware wallets are left", async () => {
    const biometrics = biometricPort();
    await mount({ wallets: [wallet("ledger")], activeWalletId: "w-ledger", session: null }, biometrics);
    expect(biometrics.remove).toHaveBeenCalledOnce();
  });

  it("keeps it while a keyfile wallet holds the password", async () => {
    const biometrics = biometricPort();
    await mount({ wallets: [wallet("jwk")], activeWalletId: "w-jwk", session: null }, biometrics);
    expect(biometrics.remove).not.toHaveBeenCalled();
  });

  it("leaves the port alone in a shell without biometrics", async () => {
    const biometrics = biometricPort();
    await mount({ wallets: [], activeWalletId: null, session: null }, biometrics, { biometrics: false });
    expect(biometrics.remove).not.toHaveBeenCalled();
  });
});
