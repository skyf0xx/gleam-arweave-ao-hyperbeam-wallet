import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import type { PasskeyStatus, RuntimePort } from "@gleam/core";
import { UnlockView } from "./UnlockView";

const ENROLLED: PasskeyStatus = { enrolled: true, credentialId: "AQID", prfSalt: "AQID", createdAt: 0 };
const PRF = new Uint8Array(32).fill(5);

class FakePublicKeyCredential {
  constructor(private readonly results: AuthenticationExtensionsClientOutputs) {}
  getClientExtensionResults() {
    return this.results;
  }
}

const get = vi.fn();

beforeEach(() => {
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
  Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });
  get.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function runtimeWith(handlers: Record<string, (payload: unknown) => unknown>): RuntimePort & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
    const handler = handlers[type];
    if (!handler) throw new Error(`unexpected ${type}`);
    return handler(payload);
  });
  return { send, onMessage: vi.fn(() => () => {}) } as unknown as RuntimePort & { send: ReturnType<typeof vi.fn> };
}

describe("UnlockView with a passkey", () => {
  it("keeps the password form when no passkey is set up", async () => {
    const runtime = runtimeWith({ getPasskeyStatus: () => ({ enrolled: false }) });
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    await waitFor(() => expect(runtime.send).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unlock with passkey/i })).toBeNull();
  });

  it("leads with the passkey and keeps the password one tap away", async () => {
    const runtime = runtimeWith({ getPasskeyStatus: () => ENROLLED });
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /unlock with passkey/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use password instead" }));
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use passkey" }));
    expect(screen.getByRole("button", { name: /unlock with passkey/i })).toBeTruthy();
  });

  it("unlocks inline with the passkey's PRF output", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential({ prf: { results: { first: PRF } } }));
    const unlockWithPasskey = vi.fn(() => ({ unlockedWalletIds: ["wallet-1"] }));
    const runtime = runtimeWith({ getPasskeyStatus: () => ENROLLED, unlockWithPasskey });
    const onUnlocked = vi.fn();
    render(<UnlockView runtime={runtime} onUnlocked={onUnlocked} onResetComplete={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /unlock with passkey/i }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(unlockWithPasskey).toHaveBeenCalledWith({ credentialId: "AQID", prfOutput: expect.any(String) });
  });

  it("treats a dismissed prompt as a cancel, not an error", async () => {
    get.mockRejectedValue(new DOMException("not allowed", "NotAllowedError"));
    const runtime = runtimeWith({ getPasskeyStatus: () => ENROLLED });
    render(<UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /unlock with passkey/i }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/cancelled/i));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands the prompt to the passkey window from the action popup", async () => {
    const openPasskeyWindow = vi.fn<(mode: "setup" | "unlock") => Promise<void>>(async () => undefined);
    const runtime = runtimeWith({ getPasskeyStatus: () => ENROLLED });
    render(
      <UnlockView runtime={runtime} onUnlocked={vi.fn()} onResetComplete={vi.fn()} />,
      fakeAppPlatform({ unlock: { passkeyMode: "window", openPasskeyWindow } }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /unlock with passkey/i }));

    await waitFor(() => expect(openPasskeyWindow).toHaveBeenCalledExactlyOnceWith("unlock"));
    expect(get).not.toHaveBeenCalled();
  });

  it("starts the prompt on its own in the passkey window", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential({ prf: { results: { first: PRF } } }));
    const runtime = runtimeWith({
      getPasskeyStatus: () => ENROLLED,
      unlockWithPasskey: () => ({ unlockedWalletIds: ["wallet-1"] }),
    });
    const onUnlocked = vi.fn();
    render(<UnlockView runtime={runtime} onUnlocked={onUnlocked} onResetComplete={vi.fn()} autoStartPasskey />);

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(get).toHaveBeenCalledOnce();
  });
});
