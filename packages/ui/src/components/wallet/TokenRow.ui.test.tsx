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

describe("TokenRow cached", () => {
  it("renders faded from the first frame while cached, and lighter than while loading", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" cached />);
    expect(screen.getByText("1.5").className).toContain("opacity-70");
    expect(screen.getByText("$3.00").className).toContain("opacity-70");
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" loading cached />);
    expect(screen.getByText("1.5").className).toContain("opacity-50");
    expect(screen.getByText("1.5").className).not.toContain("opacity-70");
  });

  it("pulses while the live read is in flight, and rests still when it is not", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" cached cachedFetching />);
    for (const text of ["1.5", "$3.00"]) {
      expect(screen.getByText(text).className).toContain("gleam-cached-pulse");
      expect(screen.getByText(text).className).not.toContain("opacity-70");
    }
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" value="$3.00" cached />);
    expect(screen.getByText("1.5").className).toContain("opacity-70");
    expect(screen.getByText("1.5").className).not.toContain("gleam-cached-pulse");
  });

  it("fades up to full once the data is fresh", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" cached />);
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" />);
    const className = screen.getByText("1.5").className;
    expect(className).not.toContain("opacity-70");
    expect(className).toContain("duration-500");
    expect(className).toContain("ease-out");
  });

  it("swaps a changed amount in place without ticking through frames", () => {
    const { rerender } = render(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="1.5" />);
    rerender(<TokenRow glyph={{ label: "AR" }} name="Arweave" amount="9.5" />);
    expect(screen.getByText("9.5")).toBeTruthy();
  });
});
