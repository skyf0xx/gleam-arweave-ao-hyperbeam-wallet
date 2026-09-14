import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  BeamMark,
  StepDots,
  PasswordField,
  PasswordStrengthMeter,
  AddressReveal,
} from "./index";

/**
 * Presentational components — lighter tests (render + basic interaction)
 * per the onboarding-unlock packet: the real logic under test lives in
 * `apps/extension/src/handlers/wallet-lifecycle.ts`.
 *
 * `KeyfileDropzone`/`ScreenHeader` were retired from this directory by
 * the design-system-pass onboarding-unlock layer (migrated onto the
 * shared `packages/ui/src/primitives/{FileDropzone,ScreenHeader}`, which
 * carry their own primitive-level tests) — no longer tested here.
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

  it("renders the shared Beam primitive as the identity mark, not a bespoke gradient", () => {
    const { container } = render(<BeamMark tagline="Simple. Fast. Easy." />);
    expect(container.querySelector(".gleam-beam-divider")).toBeTruthy();
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

  it("renders an inline error message, not a summary block, via the shared TextField", () => {
    render(<PasswordField label="Password" errorMessage="That password is too common." />);
    expect(screen.getByRole("alert").textContent).toContain("too common");
  });

  it("renders without a label (unlock screen usage has no visible label text requirement beyond placeholder)", () => {
    render(<PasswordField placeholder="Enter your password" />);
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.queryByText("Password")).toBeNull();
  });

  it("shows the caps-lock hint only when capsLockOn is true", () => {
    const { rerender } = render(<PasswordField label="Password" capsLockOn={false} />);
    expect(screen.queryByText("Caps Lock is on")).toBeNull();
    rerender(<PasswordField label="Password" capsLockOn={true} />);
    expect(screen.getByText("Caps Lock is on")).toBeTruthy();
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
