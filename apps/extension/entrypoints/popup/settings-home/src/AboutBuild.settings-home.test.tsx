import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutBuild } from "./AboutBuild";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("AboutBuild", () => {
  it("shows the version with a link to its release", () => {
    render(<AboutBuild version="1.26.0" commit={SHA} />);

    expect(screen.getByText("Version 1.26.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View release" }).getAttribute("href")).toBe(
      "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/tag/v1.26.0",
    );
  });

  it("shows the short commit linked to the full sha", () => {
    render(<AboutBuild version="1.26.0" commit={SHA} />);

    const link = screen.getByRole("link", { name: "0123456" });
    expect(link.getAttribute("href")).toBe(`https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/commit/${SHA}`);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("hides the commit when it is unknown", () => {
    render(<AboutBuild version="1.26.0" commit="unknown" />);

    expect(screen.getByText("Version 1.26.0")).toBeTruthy();
    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.queryByText("unknown")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
