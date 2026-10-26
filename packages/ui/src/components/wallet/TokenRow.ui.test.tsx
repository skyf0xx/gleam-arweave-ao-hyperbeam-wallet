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
