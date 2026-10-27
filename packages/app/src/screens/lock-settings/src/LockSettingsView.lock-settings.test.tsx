import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LockSettings, RuntimePort } from "@gleam/core";
import { LockSettingsView } from "./LockSettingsView";

afterEach(() => {
  cleanup();
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

const NEVER: LockSettings = { autoLockTimeout: "never" };

/** Answers by message type, so the sections' independent loads can run in any order. */
function sendFor({ lock = NEVER as LockSettings | Error, phrase = null as unknown } = {}) {
  let lockFailures = lock instanceof Error ? 1 : 0;
  return vi.fn(async ({ type }: { type: string }) => {
    if (type === "getLockSettings") {
      if (lockFailures > 0) {
        lockFailures -= 1;
        throw lock;
      }
      return lock instanceof Error ? NEVER : lock;
    }
    if (type === "getSecurityPhrase") return phrase;
    return undefined;
  }) as unknown as RuntimePort["send"] & ReturnType<typeof vi.fn>;
}

describe("LockSettingsView (1.6 lock-settings)", () => {
  it("loads current settings via getLockSettings and marks the active option", async () => {
    const send = sendFor({ lock: { autoLockTimeout: "5min" } });
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("5 minutes")).toBeTruthy());
    expect(send).toHaveBeenCalledWith({ type: "getLockSettings", payload: undefined });
  });

  it("Lock now calls lockWallet then onLocked", async () => {
    const send = sendFor();
    const onLocked = vi.fn();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={onLocked} />);

    await waitFor(() => expect(screen.getByText("Lock now")).toBeTruthy());
    fireEvent.click(screen.getByText("Lock now"));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "lockWallet", payload: undefined }));
    await waitFor(() => expect(onLocked).toHaveBeenCalled());
  });

  it("selecting a timeout calls setLockSettings with that value", async () => {
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("1 hour")).toBeTruthy());
    fireEvent.click(screen.getByText("1 hour"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "setLockSettings", payload: { autoLockTimeout: "1hr" } }),
    );
  });

  it("warns while Never is selected, and drops the warning once a timeout is picked", async () => {
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("note").textContent).toMatch(/stays unlocked always, even when your computer locks/));
    fireEvent.click(screen.getByText("1 hour"));

    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
    expect(screen.getByText(/whenever your computer locks/)).toBeTruthy();
  });

  it("stops promising a lock on OS lock where the shell has none", async () => {
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} lockOnSystemLock={false} />);

    await waitFor(() => expect(screen.getByRole("note").textContent).toBe("Gleam stays unlocked always."));
    fireEvent.click(screen.getByText("1 hour"));

    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
    expect(screen.getByText("Gleam locks after this long without use.")).toBeTruthy();
    expect(screen.queryByText(/computer locks/)).toBeNull();
  });

  it("does not re-save when the already-selected timeout is tapped again", async () => {
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Never")).toBeTruthy());
    fireEvent.click(screen.getByText("Never"));

    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setLockSettings" }));
  });

  it("shows the network error banner on a failed load", async () => {
    const send = sendFor({ lock: new Error("unreachable") });
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the network/i)).toBeTruthy());
  });

  it("calls onBack when the header back button is pressed", async () => {
    const onBack = vi.fn();
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={onBack} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Never")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("LockSettingsView security phrase section", () => {
  it("shows the current phrase", async () => {
    const send = sendFor({ phrase: { word: "willow" } });
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText("Your security phrase: willow")).toBeTruthy());
  });

  it("changes the phrase in place", async () => {
    const send = sendFor({ phrase: { word: "willow" } });
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Change" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "harbor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText("Your security phrase: harbor")).toBeTruthy());
    expect(send).toHaveBeenCalledWith({ type: "setSecurityPhrase", payload: { word: "harbor" } });
  });

  it("offers to set one up when none is set, and won't save a blank word", async () => {
    const send = sendFor();
    render(<LockSettingsView runtime={fakeRuntime({ send })} onBack={vi.fn()} onLocked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Set up an anti-phishing phrase")).toBeTruthy());
    fireEvent.click(screen.getByText("Set up an anti-phishing phrase"));
    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "  " } });

    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LockSettingsView passkey section", () => {
  function sendFor(passkey: unknown) {
    return vi.fn(async ({ type }: { type: string }) => {
      if (type === "getLockSettings") return NEVER;
      if (type === "getPasskeyStatus") return passkey;
      return undefined;
    }) as unknown as RuntimePort["send"] & ReturnType<typeof vi.fn>;
  }

  it("offers passkey setup and opens the setup window", async () => {
    const onSetUpPasskey = vi.fn(async () => undefined);
    render(
      <LockSettingsView
        runtime={fakeRuntime({ send: sendFor({ enrolled: false }) })}
        onBack={vi.fn()}
        onLocked={vi.fn()}
        onSetUpPasskey={onSetUpPasskey}
        passkeysSupported
      />,
    );

    fireEvent.click(await screen.findByText("Set up a passkey"));
    await waitFor(() => expect(onSetUpPasskey).toHaveBeenCalledOnce());
  });

  it("says so when the browser has no passkeys", async () => {
    render(
      <LockSettingsView
        runtime={fakeRuntime({ send: sendFor({ enrolled: false }) })}
        onBack={vi.fn()}
        onLocked={vi.fn()}
        onSetUpPasskey={vi.fn()}
        passkeysSupported={false}
      />,
    );

    expect(await screen.findByText("Passkeys aren't available in this browser.")).toBeTruthy();
  });

  it("removes an enrolled passkey", async () => {
    const send = sendFor({ enrolled: true, credentialId: "cred", prfSalt: "salt", createdAt: Date.UTC(2026, 0, 2) });
    render(
      <LockSettingsView
        runtime={fakeRuntime({ send })}
        onBack={vi.fn()}
        onLocked={vi.fn()}
        onSetUpPasskey={vi.fn()}
        passkeysSupported
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "removePasskey", payload: undefined }));
    expect(await screen.findByText("Set up a passkey")).toBeTruthy();
  });
});
