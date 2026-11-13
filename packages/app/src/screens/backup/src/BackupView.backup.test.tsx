import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { BackupStatus, RuntimePort } from "@gleam/core";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { BackupView } from "./BackupView";

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
    expect(screen.getByText(/in your Google account/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "backUpNow", payload: undefined }));
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

  it("turns off only after the delete is confirmed", async () => {
    const { runtime, send } = runtimeWith(ON, { turnOffBackup: async () => OFF });
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    expect(send).not.toHaveBeenCalledWith({ type: "turnOffBackup", payload: undefined });
    expect(screen.getByText("Delete the backup from Google?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete backup" }));
    expect(await screen.findByRole("button", { name: "Back up to Google" })).toBeTruthy();
  });

  it("keeps the backup when the delete is cancelled", async () => {
    const { runtime, send } = runtimeWith(ON);
    render(<BackupView runtime={runtime} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Back up now" })).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
