import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { bytesToBase64Url, type RuntimePort } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import { OnboardingView } from "./OnboardingView";

afterEach(cleanup);

function runtimeWith(answers: Record<string, () => Promise<unknown>>) {
  const send = vi.fn(async (message: { type: string }) => answers[message.type]!());
  return { runtime: { send, onMessage: () => () => {} } as unknown as RuntimePort, send };
}

function withGoogle() {
  return fakeAppPlatform({ capabilities: { cloudBackup: "google" } });
}

async function openExisting(runtime: RuntimePort, onComplete = vi.fn(), platform = withGoogle()) {
  render(<OnboardingView runtime={runtime} onComplete={onComplete} />, platform);
  fireEvent.click(await screen.findByRole("button", { name: "I already have a wallet" }));
  return onComplete;
}

describe("OnboardingView: restore from a backup", () => {
  it("is not offered where the shell has no cloud account", async () => {
    await openExisting(runtimeWith({}).runtime, vi.fn(), fakeAppPlatform());
    expect(screen.queryByText("Restore from Google")).toBeNull();
  });

  it("finds the backup, asks for the password, restores and finishes", async () => {
    const { runtime, send } = runtimeWith({
      findBackup: async () => ({ found: true }),
      restoreBackup: async () => ({ unlockedWalletIds: ["wallet-1"] }),
    });
    const onComplete = await openExisting(runtime);
    fireEvent.click(screen.getByText("Restore from Google"));

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "hunter2 hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith({ type: "restoreBackup", payload: { password: "hunter2 hunter2" } });
  });

  it("says so when the account holds no backup, and stays on the list", async () => {
    const { runtime } = runtimeWith({ findBackup: async () => ({ found: false }) });
    await openExisting(runtime);
    fireEvent.click(screen.getByText("Restore from Google"));
    expect(await screen.findByText("No backup found in this account.")).toBeTruthy();
    expect(screen.getByText("Recovery phrase")).toBeTruthy();
  });

  it("shows a wrong password on the field and finishes nothing", async () => {
    const { runtime } = runtimeWith({
      findBackup: async () => ({ found: true }),
      restoreBackup: async () => {
        throw new Error("That password didn't open this backup.");
      },
    });
    const onComplete = await openExisting(runtime);
    fireEvent.click(screen.getByText("Restore from Google"));
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("That password didn't open this backup.")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("OnboardingView: a restore the popup closed on", () => {
  it("picks up at the password step when reopened", async () => {
    const { runtime } = runtimeWith({
      findBackup: async () => ({ found: true }),
      restoreBackup: async () => ({ unlockedWalletIds: ["wallet-1"] }),
    });
    const platform = withGoogle();
    await openExisting(runtime, vi.fn(), platform);
    fireEvent.click(screen.getByText("Restore from Google"));
    await screen.findByLabelText("Password");
    cleanup();

    const onComplete = vi.fn();
    render(<OnboardingView runtime={runtime} onComplete={onComplete} />, platform);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "hunter2 hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());

    cleanup();
    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />, platform);
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
  });

  it("starts at Welcome again once the user backs out of the restore", async () => {
    const { runtime } = runtimeWith({ findBackup: async () => ({ found: true }) });
    const platform = withGoogle();
    await openExisting(runtime, vi.fn(), platform);
    fireEvent.click(screen.getByText("Restore from Google"));
    await screen.findByLabelText("Password");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    cleanup();

    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />, platform);
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeTruthy();
  });
});

describe("OnboardingView: restore with a passkey", () => {
  const RAW_ID = new Uint8Array([1, 2, 3, 4]);
  const PRF = new Uint8Array(32).fill(9);
  const PASSKEY = { credentialId: bytesToBase64Url(RAW_ID), prfSalt: bytesToBase64Url(new Uint8Array(32).fill(1)) };
  const get = vi.fn();

  class FakePublicKeyCredential {
    constructor(readonly rawId: ArrayBuffer) {}
    getClientExtensionResults() {
      return { prf: { results: { first: PRF } } };
    }
  }

  beforeEach(() => {
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
    Object.defineProperty(navigator, "credentials", { value: { create: vi.fn(), get }, configurable: true });
    get.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withPasskeys = () => fakeAppPlatform({ capabilities: { cloudBackup: "google", passkey: true } });

  it("restores with a passkey the backup lists, without the password", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer));
    const { runtime, send } = runtimeWith({
      findBackup: async () => ({ found: true, passkeys: [PASSKEY] }),
      restoreBackup: async () => ({ unlockedWalletIds: ["wallet-1"] }),
    });
    const onComplete = await openExisting(runtime, vi.fn(), withPasskeys());
    fireEvent.click(screen.getByText("Restore from Google"));
    fireEvent.click(await screen.findByRole("button", { name: "Use passkey" }));

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith({
      type: "restoreBackup",
      payload: { credentialId: PASSKEY.credentialId, prfOutput: bytesToBase64Url(PRF) },
    });
  });

  it("shows a closed prompt on the field and keeps the password way in", async () => {
    get.mockRejectedValue(new DOMException("closed", "NotAllowedError"));
    const { runtime, send } = runtimeWith({ findBackup: async () => ({ found: true, passkeys: [PASSKEY] }) });
    await openExisting(runtime, vi.fn(), withPasskeys());
    fireEvent.click(screen.getByText("Restore from Google"));
    fireEvent.click(await screen.findByRole("button", { name: "Use passkey" }));

    expect(await screen.findByText("The passkey request was cancelled or timed out.")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "restoreBackup" }));
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("isn't offered where the shell has no passkeys, or the backup lists none", async () => {
    const listed = runtimeWith({ findBackup: async () => ({ found: true, passkeys: [PASSKEY] }) });
    await openExisting(listed.runtime, vi.fn(), fakeAppPlatform({ capabilities: { cloudBackup: "google", passkey: false } }));
    fireEvent.click(screen.getByText("Restore from Google"));
    await screen.findByLabelText("Password");
    expect(screen.queryByRole("button", { name: "Use passkey" })).toBeNull();
    cleanup();

    const none = runtimeWith({ findBackup: async () => ({ found: true, passkeys: [] }) });
    await openExisting(none.runtime, vi.fn(), withPasskeys());
    fireEvent.click(screen.getByText("Restore from Google"));
    await screen.findByLabelText("Password");
    expect(screen.queryByRole("button", { name: "Use passkey" })).toBeNull();
  });
});
