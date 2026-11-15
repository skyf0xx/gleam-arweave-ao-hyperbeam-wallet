import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { BackupStatus, RuntimePort } from "@gleam/core";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { BackupView, DONE_MS } from "./BackupView";

afterEach(cleanup);

const OFF: BackupStatus = { provider: "google", enabled: false, lastBackupAt: null, problem: null };
const ON: BackupStatus = { provider: "google", enabled: true, lastBackupAt: Date.now(), problem: null };

type Answers = Partial<Record<string, (payload: unknown) => Promise<BackupStatus>>>;

function runtimeWith(status: BackupStatus, answers: Answers = {}) {
  const send = vi.fn(async (message: { type: string; payload: unknown }) => {
    const answer = answers[message.type];
    return answer ? answer(message.payload) : status;
  });
  return { runtime: { send, onMessage: () => () => {} } as unknown as RuntimePort, send };
}

describe("BackupView: off", () => {
  it("asks for the password and names the account", async () => {
    const { runtime } = runtimeWith(OFF);
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Back up to Google" })).toHaveProperty("disabled", true);
    expect(screen.getByText("wallets, contacts and settings").tagName).toBe("STRONG");
    expect(screen.getByText(/backed up to Google Drive/)).toBeTruthy();
  });

  it("sets up with the typed password, then shows the backup as current", async () => {
    const { runtime, send } = runtimeWith(OFF, { setUpBackup: async () => ON });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "hunter2 hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Back up to Google" }));

    expect(await screen.findByText("just now")).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "setUpBackup", payload: { password: "hunter2 hunter2" } });
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("shows a refused password on the field", async () => {
    const { runtime } = runtimeWith(OFF, {
      setUpBackup: async () => {
        throw new Error("That password didn't work. Use the password you unlock Gleam with.");
      },
    });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Back up to Google" }));
    expect(await screen.findByText(/That password didn't work/)).toBeTruthy();
  });
});

describe("BackupView: on", () => {
  it("shows when the backup was last written and writes it on request", async () => {
    const { runtime, send } = runtimeWith({ ...ON, lastBackupAt: Date.now() - 5 * 60_000 });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    expect(await screen.findByText("5m ago")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "syncBackupNow", payload: undefined }));
  });

  it("holds the button on Synced for a moment after a sync, then offers it again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { runtime } = runtimeWith(ON);
      render(<BackupView runtime={runtime} onBack={vi.fn()} />);
      // A loaded CI runner can take longer than findBy's default second to settle.
      fireEvent.click(await screen.findByRole("button", { name: "Sync now" }, { timeout: 5000 }));

      const held = await screen.findByRole("button", { name: "Synced" }, { timeout: 5000 });
      expect(held).toHaveProperty("disabled", true);
      expect(screen.getByRole("status").textContent).toBe("Synced");

      act(() => vi.advanceTimersByTime(DONE_MS));
      expect(await screen.findByRole("button", { name: "Sync now" }, { timeout: 5000 })).toHaveProperty("disabled", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't claim a backup that failed", async () => {
    const { runtime } = runtimeWith(ON, {
      syncBackupNow: async () => {
        throw new Error("Couldn't reach your backup. Check your connection and try again.");
      },
    });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Synced" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sync now" })).toHaveProperty("disabled", false);
  });

  it("offers a sign-in when the account wants one", async () => {
    const { runtime } = runtimeWith({ ...ON, problem: "signIn" });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    expect(await screen.findByText("Needs sign-in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("says when the file is gone from the account", async () => {
    const { runtime } = runtimeWith({ ...ON, problem: "missing" });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    expect(await screen.findByText("Not found")).toBeTruthy();
  });

  it("stops syncing on this device only after it is confirmed, and leaves the file", async () => {
    const { runtime, send } = runtimeWith(ON, { stopBackupSync: async () => OFF });
    const onBack = vi.fn();
    render(<BackupView runtime={runtime} onBack={onBack} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop syncing" }));
    expect(send).not.toHaveBeenCalledWith({ type: "stopBackupSync", payload: undefined });
    expect(screen.getByText("Stop syncing on this device?")).toBeTruthy();
    expect(screen.getByText("Your backup will remain on Google Drive")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop syncing" }));
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({ type: "stopBackupSync", payload: undefined });
    expect(send).not.toHaveBeenCalledWith({ type: "deleteBackup", payload: undefined });
  });

  it("deletes the file for every device only past a second confirmation", async () => {
    const { runtime, send } = runtimeWith(ON, { deleteBackup: async () => OFF });
    const onBack = vi.fn();
    render(<BackupView runtime={runtime} onBack={onBack} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop syncing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete backup from Google Drive" }));
    expect(screen.getByText("Delete the backup from Google Drive?")).toBeTruthy();
    expect(screen.getByText("Every device will stop syncing")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith({ type: "deleteBackup", payload: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Delete backup" }));
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith({ type: "deleteBackup", payload: undefined });
  });

  it("keeps syncing when either step is cancelled", async () => {
    const { runtime, send } = runtimeWith(ON);
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop syncing" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop syncing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete backup from Google Drive" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
