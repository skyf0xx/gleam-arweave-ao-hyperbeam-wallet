import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { AboutBuild } from "./AboutBuild";

afterEach(cleanup);

function runtimeReturning(total: number | null | Error): RuntimePort {
  return {
    send: vi.fn(async () => {
      if (total instanceof Error) throw total;
      return total === null ? null : { total, paidPlacesLeft: 20 };
    }),
    onMessage: vi.fn(() => () => {}),
  } as unknown as RuntimePort;
}

function render(ui: (runtime: RuntimePort) => React.ReactElement, runtime = runtimeReturning(null)) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui(runtime)}</QueryClientProvider>);
}

describe("AboutBuild", () => {
  it("shows the version with a link to its release", () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" />);

    expect(screen.getByText("Version 1.26.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View release" }).getAttribute("href")).toBe(
      "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/tag/v1.26.0",
    );
  });

  it("links the community audits of this version with their count", async () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" />, runtimeReturning(7));

    const link = await screen.findByRole("link", { name: "7 audits →" });
    expect(link.getAttribute("href")).toBe("https://gleamwallet.app/review-results.html?v=1.26.0");
  });

  it("says 1 audit in the singular", async () => {
    render((runtime) => <AboutBuild runtime={runtime} version="1.26.0" />, runtimeReturning(1));

    expect(await screen.findByRole("link", { name: "1 audit →" })).toBeTruthy();
  });

  it.each([null, new Error("boom")])("shows the row without a count when it can't be read (%s)", async (result) => {
    const runtime = runtimeReturning(result);
    render((r) => <AboutBuild runtime={r} version="1.26.0" />, runtime);

    await waitFor(() => expect(runtime.send).toHaveBeenCalledWith({ type: "getScanStats", payload: undefined }));
    expect(screen.getByRole("link", { name: "View audits →" }).getAttribute("href")).toBe(
      "https://gleamwallet.app/review-results.html?v=1.26.0",
    );
  });
});
