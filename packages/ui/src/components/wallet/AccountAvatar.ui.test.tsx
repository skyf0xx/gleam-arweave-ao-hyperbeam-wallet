import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountAvatar } from "./AccountAvatar";

afterEach(cleanup);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#8b12ff"/></svg>';

describe("AccountAvatar", () => {
  it("renders the SVG as an image data URI, labelled for screen readers", () => {
    render(<AccountAvatar svgMarkup={SVG} label="Main avatar" size={32} />);
    const avatar = screen.getByRole("img", { name: "Main avatar" });
    expect(avatar.style.width).toBe("32px");
    expect(avatar.style.height).toBe("32px");

    const img = avatar.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`);
    expect(avatar.querySelector("svg")).toBeNull();
  });

  it("never turns hostile markup into DOM", () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg><img src=x onerror="alert(1)">';
    const { container } = render(<AccountAvatar svgMarkup={hostile} label="Avatar" />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});
