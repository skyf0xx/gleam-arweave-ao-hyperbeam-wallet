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

  it("renders every chunk flat in one grid, 7 columns by default and 4 on the phone", () => {
    const { container } = render(<MemorableAddress address={ADDRESS} emphasisPick={null} />);
    const grid = screen.getByText(addressText(ADDRESS));
    expect(grid.children).toHaveLength(11);
    expect(Array.from(grid.children).map((chunk) => chunk.textContent).join("")).toBe(ADDRESS);
    expect(grid.className).toContain("grid-cols-[repeat(7,max-content)]");
    expect(grid.className).toContain("phone:grid-cols-[repeat(4,max-content)]");
    expect(grid.className).not.toContain("flex-wrap");
    expect(container.querySelector(".flex-wrap")).toBeNull();
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
