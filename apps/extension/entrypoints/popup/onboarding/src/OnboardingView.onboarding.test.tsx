import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { OnboardingView } from "./OnboardingView";

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

const GOOD_PASSWORD = "correct horse battery staple";

describe("OnboardingView: create flow", () => {
  it("walks welcome -> password -> backup and calls createWallet then exportWallet", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "wallet-1", name: "Wallet 1" }) // createWallet
      .mockResolvedValueOnce({ kty: "RSA", n: "example" }); // exportWallet
    const runtime = fakeRuntime({ send });
    const onComplete = vi.fn();

    render(<OnboardingView runtime={runtime} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));

    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Your wallet is ready")).toBeTruthy());

    expect(send).toHaveBeenNthCalledWith(1, {
      type: "createWallet",
      payload: { name: "Wallet 1", password: GOOD_PASSWORD },
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "exportWallet",
      payload: { walletId: "wallet-1", password: GOOD_PASSWORD },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("surfaces a server-side rejection (e.g. common password) as an inline error", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("That password is too common."));
    const runtime = fakeRuntime({ send });

    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a wallet" }));

    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.change(screen.getByPlaceholderText("Re-enter your password"), {
      target: { value: GOOD_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("too common"));
  });
});

describe("OnboardingView: import flow", () => {
  it("rejects an invalid keyfile with a specific reason before allowing continue", () => {
    const runtime = fakeRuntime();
    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Import a wallet" }));
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: { value: '{"not":"a jwk"}' },
    });

    expect(screen.getByRole("alert").textContent).toContain("isn't a valid Arweave keyfile");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  });

  it("proceeds to the password step once a structurally valid JWK is pasted", () => {
    const runtime = fakeRuntime();
    render(<OnboardingView runtime={runtime} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Import a wallet" }));
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: {
        value: JSON.stringify({
          kty: "RSA",
          e: "AQAB",
          n: "n".repeat(10),
          d: "d".repeat(10),
          p: "p".repeat(10),
          q: "q".repeat(10),
          dp: "d".repeat(10),
          dq: "d".repeat(10),
          qi: "q".repeat(10),
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Import a wallet")).toBeTruthy();
  });
});
