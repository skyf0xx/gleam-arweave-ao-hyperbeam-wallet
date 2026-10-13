import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollectibleThumbnail } from "./CollectibleThumbnail";

afterEach(cleanup);

describe("CollectibleThumbnail", () => {
  it("loads the image through a lazy, referrer-less <img>", () => {
    render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/abc" />);
    const img = screen.getByAltText("Frog");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://arweave.net/abc");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("shows the plain tile when there is no image", () => {
    render(<CollectibleThumbnail name="Doc" />);
    expect(screen.getByTestId("collectible-placeholder")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back to the plain tile when the image fails to load", () => {
    render(<CollectibleThumbnail name="Frog" imageUrl="https://arweave.net/broken" />);
    fireEvent.error(screen.getByAltText("Frog"));
    expect(screen.queryByAltText("Frog")).toBeNull();
    expect(screen.getByTestId("collectible-placeholder")).toBeTruthy();
  });
});
