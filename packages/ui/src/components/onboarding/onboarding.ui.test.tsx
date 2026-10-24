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
 * `packages/runtime/src/handlers/wallet-lifecycle.ts`.
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
    render(<BeamMark tagline="crypto, without the clutter." />);
    expect(screen.getByText("gleam")).toBeTruthy();
    expect(screen.getByText("crypto, without the clutter.")).toBeTruthy();
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
    render(<PasswordField label="Password" placeholder="At least 8 characters" />);
    const input = screen.getByPlaceholderText("At least 8 characters") as HTMLInputElement;
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
    expect(container.querySelectorAll("[aria-hidden='true'] > span").length).toBe(4);
  });
});

describe("ui/onboarding: AddressReveal", () => {
  it("offers a download and a skip before the keyfile is saved", () => {
    const onDownload = vi.fn();
    const onSkip = vi.fn();
    render(<AddressReveal onDownload={onDownload} onSkip={onSkip} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download keyfile" }));
    expect(onDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("I'll back this up later"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("names the saved file and drops the skip link once saved", () => {
    render(
      <AddressReveal savedAs="jade-arweave-keyfile.json" onDownload={vi.fn()} onSkip={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText("Saved as jade-arweave-keyfile.json")).toBeTruthy();
    expect(screen.queryByText("I'll back this up later")).toBeNull();
  });

  it("disables the download while saving and shows a failure", () => {
    render(
      <AddressReveal
        downloading
        downloadError="The download failed."
        onDownload={vi.fn()}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Download keyfile" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("The download failed.");
  });
});
