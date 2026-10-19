import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemorableAddress } from "./MemorableAddress";
import { addressText } from "./MemorableAddress.testing";

afterEach(cleanup);

const ADDRESS = "weY8dOVhGi9BhGV3B-pkKVWA1ox_n8gzSKOHOJ14uFk";

describe("MemorableAddress", () => {
  it("renders the address as text with no characters between the chunks", () => {
    render(<MemorableAddress address={ADDRESS} emphasisPick={null} />);
    expect(screen.getByText(addressText(ADDRESS))).toBeTruthy();
  });

  it("emphasises the first, last and two middle chunks", () => {
    const { container } = render(<MemorableAddress address={ADDRESS} emphasisPick={null} />);
    const emphasized = Array.from(container.querySelectorAll("[data-emphasized]")).map((chunk) => chunk.textContent);
    expect(emphasized).toEqual(["weY8", "hGV3", "n8gz", "uFk"]);
  });

  it("shows only the emphasised chunks in the compact layout, with the full address as its title", () => {
    const { container } = render(<MemorableAddress address={ADDRESS} emphasisPick={null} layout="compact" />);
    expect(container.textContent).toBe("weY8…hGV3…n8gz…uFk");
    expect(container.firstElementChild!.getAttribute("title")).toBe(ADDRESS);
  });

  it("copies a selection inside it as the raw address text", () => {
    render(<MemorableAddress address={ADDRESS} emphasisPick={null} />);
    const holder = screen.getByText(addressText(ADDRESS));
    const range = document.createRange();
    range.selectNodeContents(holder);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const data = new Map<string, string>();
    fireEvent.copy(holder, { clipboardData: { setData: (type: string, value: string) => data.set(type, value) } });
    expect(data.get("text/plain")).toBe(ADDRESS);
  });
});
