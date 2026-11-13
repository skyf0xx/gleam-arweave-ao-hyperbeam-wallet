import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BackupStatus, RuntimePort } from "@gleam/core";
import { BackupSection } from "./BackupSection";

afterEach(cleanup);

function runtimeWith(status: BackupStatus): RuntimePort {
  return { send: vi.fn(async () => status), onMessage: () => () => {} } as unknown as RuntimePort;
}

const OFF: BackupStatus = { provider: "google", enabled: false, lastBackupAt: null, problem: null };

describe("BackupSection", () => {
  it("names the drive and says when backup is off", async () => {
    render(<BackupSection runtime={runtimeWith(OFF)} provider="google" onOpen={vi.fn()} />);
    expect(await screen.findByText("Google Drive")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("shows the last backup when it is current", async () => {
    render(<BackupSection runtime={runtimeWith({ ...OFF, enabled: true, lastBackupAt: Date.now() })} provider="google" onOpen={vi.fn()} />);
    expect(await screen.findByText("Last backup · just now")).toBeTruthy();
  });

  it("shows what needs the user", async () => {
    render(<BackupSection runtime={runtimeWith({ ...OFF, enabled: true, problem: "signIn" })} provider="google" onOpen={vi.fn()} />);
    expect(await screen.findByText("Needs sign-in")).toBeTruthy();
  });

  it("opens the Backup screen", async () => {
    const onOpen = vi.fn();
    render(<BackupSection runtime={runtimeWith(OFF)} provider="google" onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Google Drive"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
