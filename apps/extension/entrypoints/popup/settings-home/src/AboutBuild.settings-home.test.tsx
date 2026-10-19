import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { AboutBuild } from "./AboutBuild";

afterEach(cleanup);

function runtimeReturning(count: number | null | Error): RuntimePort {
  return {
    send: vi.fn(async () => {
      if (count instanceof Error) throw count;
      return count;
    }),
    onMessage: vi.fn(() => () => {}),
  } as unknown as RuntimePort;
}

function render(ui: (runtime: RuntimePort) => React.ReactElement, runtime = runtimeReturning(null)) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui(runtime)}</QueryClientProvider>);
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("AboutBuild", () => {
  it("shows the version with a link to its release", () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" commit={SHA} />);

    expect(screen.getByText("Version 1.26.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View release" }).getAttribute("href")).toBe(
      "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/tag/v1.26.0",
    );
  });

  it("shows the short commit linked to the full sha", () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" commit={SHA} />);

    const link = screen.getByRole("link", { name: "0123456" });
    expect(link.getAttribute("href")).toBe(`https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/commit/${SHA}`);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("hides the commit when it is unknown", () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" commit="unknown" />);

    expect(screen.getByText("Version 1.26.0")).toBeTruthy();
    expect(screen.queryByText("Commit")).toBeNull();
    expect(screen.queryByText("unknown")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("links the community scans of this version with their count", async () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" commit={SHA} />, runtimeReturning(7));

    const link = await screen.findByRole("link", { name: "7 scans →" });
    expect(link.getAttribute("href")).toBe("https://gleamwallet.app/scan.html?v=1.26.0");
  });

  it("says 1 scan in the singular", async () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" commit={SHA} />, runtimeReturning(1));

    expect(await screen.findByRole("link", { name: "1 scan →" })).toBeTruthy();
  });

  it.each([null, new Error("boom")])("shows the row without a count when it can't be read (%s)", async (result) => {
    const runtime = runtimeReturning(result);
    render((r) => <AboutBuild runtime={r} version="1.26.0" commit={SHA} />, runtime);

    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith({ type: "getScanCount", payload: undefined }));
    expect(screen.getByRole("link", { name: "View scans →" }).getAttribute("href")).toBe(
      "https://gleamwallet.app/scan.html?v=1.26.0",
    );
  });
});
