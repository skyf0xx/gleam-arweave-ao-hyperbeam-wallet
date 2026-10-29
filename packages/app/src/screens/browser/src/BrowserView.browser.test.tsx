import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { BackStackContext, createBackStack } from "@gleam/ui/src/primitives/back-stack.tsx";
import { fakeAppPlatform } from "../../../app-platform/testing";
import { PlatformProvider } from "../../../app-platform/context";
import type { DappBrowserEvent, DappBrowserPort } from "../../../app-platform/types";
import { BrowserView } from "./BrowserView";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fakeBrowser() {
  let listener: (event: DappBrowserEvent) => void = () => {};
  const port: DappBrowserPort = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setFrame: vi.fn(async () => {}),
    setHidden: vi.fn(async () => {}),
    clearSiteData: vi.fn(async () => {}),
    subscribe: (next) => {
      listener = next;
      return () => {};
    },
  };
  return { port, emit: (event: DappBrowserEvent) => act(() => listener(event)) };
}

function fakeRuntime(sites = { saved: [] as string[], recent: [] as string[] }, grants: unknown[] = []) {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type === "listBrowserSites") return sites;
    if (type === "getConnectedApps") return grants;
    return undefined;
  });
  return { runtime: { send, onMessage: () => () => {} } as unknown as RuntimePort, send };
}

function mount(options: { browser?: DappBrowserPort; runtime?: RuntimePort; initialUrl?: string; onBack?: () => void } = {}) {
  const browser = options.browser ?? fakeBrowser().port;
  const runtime = options.runtime ?? fakeRuntime().runtime;
  const stack = createBackStack();
  const props = { onBack: options.onBack ?? vi.fn(), onOpenConnectedApp: vi.fn(), onLocked: vi.fn() };
  render(
    <PlatformProvider platform={fakeAppPlatform({ dappBrowser: browser, runtime })}>
      <BackStackContext.Provider value={stack}>
        <BrowserView runtime={runtime} initialUrl={options.initialUrl} {...props} />
      </BackStackContext.Provider>
    </PlatformProvider>,
  );
  return { stack, ...props };
}

describe("BrowserView start screen", () => {
  it("lists saved sites, then the built-in dApps, then recent ones, and opens no page", async () => {
    const browser = fakeBrowser();
    const { runtime } = fakeRuntime({ saved: ["https://mine.example"], recent: ["https://recent.example", "https://mine.example"] });
    mount({ browser: browser.port, runtime });

    await screen.findByText("mine.example");
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Saved", "dApps", "Recent"]);
    expect(screen.getByText("bazar.arweave.net")).toBeTruthy();
    expect(screen.getByText("ao.arweave.net")).toBeTruthy();
    // A site shown above isn't listed again as recent.
    expect(screen.getAllByText("mine.example")).toHaveLength(1);
    expect(browser.port.open).not.toHaveBeenCalled();
  });

  it("opens a tapped site at the placeholder's frame", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });
    fireEvent.click(await screen.findByText("bazar.arweave.net"));
    expect(browser.port.open).toHaveBeenCalledWith({
      url: "https://bazar.arweave.net/",
      frame: { x: 0, y: 0, width: 0, height: 0 },
    });
  });

  it("opens a typed address with https added, and says so for text that isn't one", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });
    const field = await screen.findByLabelText("Address");

    fireEvent.change(field, { target: { value: "example.com" } });
    fireEvent.submit(field);
    expect(browser.port.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/" }));
  });

  it("refuses other schemes and plain words with no match", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });
    const field = await screen.findByLabelText("Address");

    for (const value of ["javascript:alert(1)", "nothing"]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.submit(field);
      expect(await screen.findByRole("alert")).toBeTruthy();
    }
    expect(browser.port.open).not.toHaveBeenCalled();
  });

  it("narrows to tappable matches as you type, and Enter opens the typed address", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });
    const field = await screen.findByLabelText("Address");
    fireEvent.change(field, { target: { value: "arweave.net" } });
    expect(screen.getAllByText(/arweave\.net$/).length).toBeGreaterThan(1);
    fireEvent.submit(field);
    expect(browser.port.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://arweave.net/" }));
  });

  it("opens a tapped suggestion", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });
    fireEvent.change(await screen.findByLabelText("Address"), { target: { value: "ao.arweave" } });
    fireEvent.click(screen.getByText("ao.arweave.net"));
    expect(browser.port.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://ao.arweave.net/" }));
  });
});

describe("BrowserView with a page", () => {
  it("shows the punycode host and warns about http", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port, initialUrl: "https://münchen.de/" });
    await browser.emit({ kind: "navigation", url: "https://xn--mnchen-3ya.de/", canGoBack: false, loading: false });
    expect(screen.getByText("xn--mnchen-3ya.de")).toBeTruthy();
    expect(screen.queryByText("Not secure")).toBeNull();

    await browser.emit({ kind: "navigation", url: "http://plain.example/", canGoBack: false, loading: false });
    expect(screen.getByText("plain.example")).toBeTruthy();
    expect(screen.getByText("Not secure")).toBeTruthy();
  });

  it("records the origin as a recent site and saves it with the star", async () => {
    const browser = fakeBrowser();
    const { runtime, send } = fakeRuntime();
    mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false });
    expect(send).toHaveBeenCalledWith({ type: "recordRecentSite", payload: { url: "https://a.example/page" } });

    fireEvent.click(screen.getByLabelText("Save site"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "saveBrowserSite", payload: { url: "https://a.example/page" } }),
    );
  });

  it("covers and uncovers the page when the address is edited", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/", canGoBack: false, loading: false });
    fireEvent.click(screen.getByLabelText(/^Address, a\.example/));
    await waitFor(() => expect(browser.port.setHidden).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(browser.port.setHidden).toHaveBeenLastCalledWith(false));
  });

  it("goes back through the page's history, then leaves the browser, on the system back press", async () => {
    const browser = fakeBrowser();
    const { stack, onBack } = mount({ browser: browser.port, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/two", canGoBack: true, loading: false });

    expect(stack.handle()).toBe(true);
    expect(browser.port.goBack).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    await browser.emit({ kind: "navigation", url: "https://a.example/", canGoBack: false, loading: false });
    act(() => {
      expect(stack.handle()).toBe(true);
    });
    // The first page closes onto the start screen; only a second press leaves the browser.
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(browser.port.close).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("page-placeholder")).toBeNull();
    expect(screen.getByLabelText("Address")).toBeTruthy();

    act(() => {
      expect(stack.handle()).toBe(true);
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("returns to the start screen when the close button is tapped", async () => {
    const browser = fakeBrowser();
    const { onBack } = mount({ browser: browser.port, initialUrl: "https://a.example/" });
    fireEvent.click(screen.getByLabelText("Close browser"));

    await waitFor(() => expect(browser.port.close).toHaveBeenCalledTimes(1));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId("page-placeholder")).toBeNull();
  });

  it("offers a retry over a page that failed to load", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "loadError", url: "https://a.example/", message: "offline" });
    await waitFor(() => expect(browser.port.setHidden).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByText("Try again"));
    expect(browser.port.reload).toHaveBeenCalled();
  });

  it("shows the connected-site chip for a site with a grant and opens its entry", async () => {
    const browser = fakeBrowser();
    const { runtime } = fakeRuntime(undefined, [{ origin: "https://a.example" }]);
    const view = mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/x", canGoBack: false, loading: false });
    fireEvent.click(await screen.findByText("Connected"));
    expect(view.onOpenConnectedApp).toHaveBeenCalledWith("https://a.example", "https://a.example/x");
  });

  it("closes the page when the screen goes away", () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port, initialUrl: "https://a.example/" });
    cleanup();
    expect(browser.port.close).toHaveBeenCalled();
  });

  it("tells the app when a state read finds the wallet locked, without counting as activity", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return { wallets: [{}], session: null };
      return type === "listBrowserSites" ? { saved: [], recent: [] } : [];
    });
    const runtime = { send, onMessage: () => () => {} } as unknown as RuntimePort;
    const view = mount({ runtime, initialUrl: "https://a.example/" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(send).toHaveBeenCalledWith({ type: "getState", payload: { recordActivity: false } });
    expect(view.onLocked).toHaveBeenCalled();
  });
});
