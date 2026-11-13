import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
import { OnboardingView } from "./OnboardingView";

afterEach(cleanup);

function runtimeWith(answers: Record<string, () => Promise<unknown>>) {
  const send = vi.fn(async (message: { type: string }) => answers[message.type]!());
  return { runtime: { send, onMessage: () => () => {} } as unknown as RuntimePort, send };
}

const WITH_GOOGLE = fakeAppPlatform({ capabilities: { cloudBackup: "google" } });

function openExisting(runtime: RuntimePort, onComplete = vi.fn(), platform = WITH_GOOGLE) {
  render(<OnboardingView runtime={runtime} onComplete={onComplete} />, platform);
  fireEvent.click(screen.getByRole("button", { name: "I already have a wallet" }));
  return onComplete;
}

describe("OnboardingView: restore from a backup", () => {
  it("is not offered where the shell has no cloud account", () => {
    openExisting(runtimeWith({}).runtime, vi.fn(), fakeAppPlatform());
    expect(screen.queryByText("Restore from Google")).toBeNull();
  });

  it("finds the backup, asks for the password, restores and finishes", async () => {
    const { runtime, send } = runtimeWith({
      findBackup: async () => ({ found: true }),
      restoreBackup: async () => ({ unlockedWalletIds: ["wallet-1"] }),
    });
    const onComplete = openExisting(runtime);
    fireEvent.click(screen.getByText("Restore from Google"));

    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "hunter2 hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(send).toHaveBeenLastCalledWith({ type: "restoreBackup", payload: { password: "hunter2 hunter2" } });
  });

  it("says so when the account holds no backup, and stays on the list", async () => {
    const { runtime } = runtimeWith({ findBackup: async () => ({ found: false }) });
    openExisting(runtime);
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
    const onComplete = openExisting(runtime);
    fireEvent.click(screen.getByText("Restore from Google"));
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("That password didn't open this backup.")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
