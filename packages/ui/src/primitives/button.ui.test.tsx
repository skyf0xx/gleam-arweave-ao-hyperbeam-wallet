import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { cn } from "./cn";

describe("ui: Button primitive", () => {
  it("renders as a button with its label", () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("cn merges conflicting Tailwind classes deterministically", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
