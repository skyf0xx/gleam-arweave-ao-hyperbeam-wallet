import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { PasskeyError } from "@gleam/app/src/passkey/webauthn.ts";
import { PasskeySetup } from "./PasskeySetup";

afterEach(() => {
  cleanup();
});

const CREATED = { credentialId: "cred", prfSalt: "salt", prfOutput: "prf" };

function runtimeWith(send: (message: { type: string; payload: unknown }) => unknown): RuntimePort {
  return { send: vi.fn(async (message) => send(message as never)), onMessage: vi.fn(() => () => {}) } as RuntimePort;
}

function submit(password: string) {
  fireEvent.change(screen.getByPlaceholderText("Enter your Gleam password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));
}

describe("PasskeySetup", () => {
  it("checks the password, creates the passkey, then enrolls it", async () => {
    const calls: string[] = [];
    const runtime = runtimeWith(({ type }) => {
      calls.push(type);
    });
    const createPasskey = vi.fn(async () => {
      calls.push("create");
      return CREATED;
    });
    const onDone = vi.fn();
    render(<PasskeySetup runtime={runtime} onDone={onDone} createPasskey={createPasskey} />);

    submit("correct horse");

    await waitFor(() => expect(screen.getByText("Passkey ready")).toBeTruthy());
    expect(calls).toEqual(["checkVaultPassword", "create", "enrollPasskey"]);
    expect(runtime.send).toHaveBeenCalledWith({
      type: "enrollPasskey",
      payload: { password: "correct horse", ...CREATED },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("never opens the passkey prompt for a wrong password", async () => {
    const runtime = runtimeWith(({ type }) => {
      if (type === "checkVaultPassword") throw new Error("That password didn't work.");
    });
    const createPasskey = vi.fn(async () => CREATED);
    render(<PasskeySetup runtime={runtime} onDone={vi.fn()} createPasskey={createPasskey} />);

    submit("wrong");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("didn't work"));
    expect(createPasskey).not.toHaveBeenCalled();
  });

  it("lets the user retry after cancelling the prompt", async () => {
    const runtime = runtimeWith(() => undefined);
    const createPasskey = vi.fn(async () => {
      throw new PasskeyError("cancelled", "cancelled");
    });
    render(<PasskeySetup runtime={runtime} onDone={vi.fn()} createPasskey={createPasskey} />);

    submit("correct horse");

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/cancelled/i));
    expect(screen.getByRole("button", { name: "Create passkey" })).toHaveProperty("disabled", false);
  });
});
