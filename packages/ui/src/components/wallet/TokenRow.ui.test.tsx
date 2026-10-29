import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TokenRow } from "./TokenRow";

afterEach(cleanup);

describe("TokenRow amount", () => {
  it("keeps the full figure for screen readers and the hover title", () => {
    render(<TokenRow glyph={{ label: "GP" }} name="Points" amount="1.2M" amountFull="1,234,567.89" />);
    expect(screen.getByText("1,234,567.89", { selector: ".sr-only" })).toBeTruthy();
    expect(document.querySelector('[title="1,234,567.89"]')).not.toBeNull();
  });

  it("shows the full figure outright on the phone, where there is no hover", () => {
    render(
      <div data-layout="phone">
        <TokenRow glyph={{ label: "GP" }} name="Points" amount="1.2M" amountFull="1,234,567.89" />
      </div>,
    );
    expect(screen.getByText("1.2M").className).toContain("phone:hidden");
    expect(screen.getByText("1,234,567.89").className).toContain("phone:not-sr-only");
  });
});

describe("TokenRow refreshing", () => {
  it("dims lightly while refreshing, and less than while loading", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" refreshing />);
    expect(screen.getByText("1.5").className).toContain("opacity-85");
    expect(screen.getByText("$3.00").className).toContain("opacity-85");
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" loading refreshing />);
    expect(screen.getByText("1.5").className).toContain("opacity-50");
    expect(screen.getByText("1.5").className).not.toContain("opacity-85");
  });

  it("swaps a changed amount in place without ticking through frames", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" />);
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="9.5" />);
    expect(screen.getByText("9.5")).toBeTruthy();
  });
});
