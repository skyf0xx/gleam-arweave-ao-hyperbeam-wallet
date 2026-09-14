import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  BeamMark,
  StepDots,
  PasswordField,
  PasswordStrengthMeter,
  AddressReveal,
  KeyfileDropzone,
} from "./index";

/**
 * Presentational components — lighter tests (render + basic interaction)
 * per the onboarding-unlock packet: the real logic under test lives in
 * `apps/extension/src/handlers/wallet-lifecycle.ts`.
 *
 * This workspace's `vitest.config.ts` has no global `afterEach(cleanup)`
 * (out of this layer's scope to add), so tests that render more than once
 * in the same `describe` clean up explicitly to avoid duplicate-role
 * matches across renders.
 */
afterEach(() => {
  cleanup();
});

describe("ui/onboarding: BeamMark", () => {
  it("renders the wordmark and tagline", () => {
    render(<BeamMark tagline="Crypto, without the clutter." />);
    expect(screen.getByText("gleam")).toBeTruthy();
    expect(screen.getByText("Crypto, without the clutter.")).toBeTruthy();
  });
});

describe("ui/onboarding: StepDots", () => {
  it("labels the current step", () => {
    render(<StepDots total={2} current={1} />);
    expect(screen.getByLabelText("Step 1 of 2")).toBeTruthy();
  });
});

describe("ui/onboarding: PasswordField", () => {
  it("toggles reveal state on button click", () => {
    render(<PasswordField label="Password" placeholder="At least 10 characters" />);
    const input = screen.getByPlaceholderText("At least 10 characters") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
  });

  it("renders an inline error message, not a summary block", () => {
    render(<PasswordField label="Password" errorMessage="That password is too common." />);
    expect(screen.getByRole("alert").textContent).toContain("too common");
  });
});

describe("ui/onboarding: PasswordStrengthMeter", () => {
  it("renders exactly 4 bars regardless of filled count", () => {
    const { container } = render(<PasswordStrengthMeter filled={2} />);
    expect(container.querySelectorAll("span").length).toBe(4);
  });
});

describe("ui/onboarding: AddressReveal", () => {
  it("hides keyfile contents until reveal is clicked", () => {
    const onReveal = vi.fn();
    render(
      <AddressReveal
        keyfileContents='{"kty":"RSA"}'
        revealed={false}
        onReveal={onReveal}
        onDownload={vi.fn()}
        onCopy={vi.fn()}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.queryByText('{"kty":"RSA"}')).toBeNull();
    fireEvent.click(screen.getByText("Reveal"));
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("shows keyfile contents once revealed", () => {
    render(
      <AddressReveal
        keyfileContents='{"kty":"RSA"}'
        revealed={true}
        onReveal={vi.fn()}
        onDownload={vi.fn()}
        onCopy={vi.fn()}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText('{"kty":"RSA"}')).toBeTruthy();
  });
});

describe("ui/onboarding: KeyfileDropzone", () => {
  it("calls onPasteChange when the textarea changes", () => {
    const onPasteChange = vi.fn();
    render(
      <KeyfileDropzone
        pasteValue=""
        onPasteChange={onPasteChange}
        onFileRead={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/kty/), {
      target: { value: '{"kty":"RSA"}' },
    });
    expect(onPasteChange).toHaveBeenCalledWith('{"kty":"RSA"}');
  });

  it("renders the error message when provided", () => {
    render(
      <KeyfileDropzone
        pasteValue=""
        onPasteChange={vi.fn()}
        onFileRead={vi.fn()}
        errorMessage="That file isn't a valid Arweave keyfile."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("isn't a valid Arweave keyfile");
  });
});
