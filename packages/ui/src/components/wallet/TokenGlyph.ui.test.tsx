import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TokenGlyph } from "./TokenGlyph";

afterEach(cleanup);

describe("TokenGlyph", () => {
  it("shows the ticker letters without a logo", () => {
    render(<TokenGlyph label="AB" />);
    expect(screen.getByText("AB")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("loads a logo through a lazy, referrer-less <img>", () => {
    render(<TokenGlyph label="AB" logoUrl="https://arweave.net/abc" />);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://arweave.net/abc");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.queryByText("AB")).toBeNull();
  });

  it("falls back to the letters when the logo fails to load", () => {
    render(<TokenGlyph label="AB" logoUrl="https://arweave.net/broken" />);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("AB")).toBeTruthy();
  });
});
