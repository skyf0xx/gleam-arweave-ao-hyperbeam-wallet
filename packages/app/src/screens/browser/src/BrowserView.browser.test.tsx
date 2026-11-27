import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RuntimePort } from "@gleam/core";
import { BackStackContext, createBackStack } from "@gleam/ui/src/primitives/back-stack.tsx";
import { fakeAppPlatform, renderWithPlatform as render } from "../../../app-platform/testing";
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
    pageIcon: vi.fn(async (): Promise<{ origin: string; dataUrl: string } | null> => null),
    subscribe: (next) => {
      listener = next;
      return () => {};
    },
  };
  return { port, emit: (event: DappBrowserEvent) => act(() => listener(event)) };
}

function fakeRuntime(
  sites: {
    saved: string[];
    recent: string[];
    icons?: Record<string, string>;
    history?: { url: string; title: string; at: number }[];
  } = { saved: [], recent: [] },
  grants: unknown[] = [],
) {
  const send = vi.fn(async ({ type }: { type: string }) => {
    if (type === "listBrowserSites") return { icons: {}, history: [], ...sites };
    if (type === "getConnectedApps") return grants;
    return undefined;
  });
  return { runtime: { send, onMessage: () => () => {} } as unknown as RuntimePort, send };
}

function mount(options: { dappBrowser?: boolean; browser?: DappBrowserPort; runtime?: RuntimePort; initialUrl?: string; onBack?: () => void } = {}) {
  const browser = options.browser ?? fakeBrowser().port;
  const runtime = options.runtime ?? fakeRuntime().runtime;
  const stack = createBackStack();
  const props = { onBack: options.onBack ?? vi.fn(), onOpenConnectedApp: vi.fn(), onLocked: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PlatformProvider platform={fakeAppPlatform({ dappBrowser: browser, runtime, capabilities: { dappBrowser: options.dappBrowser ?? true } })}>
      <BackStackContext.Provider value={stack}>
        <BrowserView runtime={runtime} initialUrl={options.initialUrl} {...props} />
      </BackStackContext.Provider>
    </PlatformProvider>
    </QueryClientProvider>,
  );
  return { stack, ...props };
}

describe("BrowserView start screen", () => {
  it("clears site data and recent sites from the start screen", async () => {
    const browser = fakeBrowser();
    const { runtime, send } = fakeRuntime({ saved: [], recent: ["https://recent.example"] });
    mount({ browser: browser.port, runtime });

    await screen.findByText("recent.example");
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "clearRecentSites", payload: undefined }));

    fireEvent.click(screen.getByText("Clear site data"));
    fireEvent.click(within(screen.getByRole("group", { name: "Clear site data" })).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(browser.port.clearSiteData).toHaveBeenCalled());
    expect(await screen.findAllByText("Cleared")).toHaveLength(2);
  });

  it("asks before clearing site data, and clears nothing until confirmed", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port });

    fireEvent.click(await screen.findByText("Clear site data"));
    expect(screen.getByText("Sign out of all sites and delete what they stored?")).toBeTruthy();
    expect(browser.port.clearSiteData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Sign out of all sites and delete what they stored?")).toBeNull();
    expect(browser.port.clearSiteData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Clear site data"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(browser.port.clearSiteData).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Cleared")).toBeTruthy();
  });

  it("leaves the clear actions out where the host has no dApp browser", async () => {
    const { runtime } = fakeRuntime({ saved: [], recent: ["https://recent.example"] });
    mount({ runtime, dappBrowser: false });
    await screen.findByText("recent.example");
    expect(screen.queryByText("Clear site data")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear recent sites" })).toBeNull();
  });

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

  it("lists the built-in dApps alphabetically, and draws stored and bundled icons", async () => {
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    const { runtime } = fakeRuntime({ saved: ["https://mine.example"], recent: ["https://recent.example"], icons: { "https://mine.example": PNG } });
    mount({ runtime });

    const dapps = await screen.findByRole("region", { name: "dApps" });
    expect(within(dapps).getAllByRole("button").map((row) => row.textContent)).toEqual([
      "ao.arweave.net",
      "bazar.arweave.net",
      "iwashere.ar.io",
      "www.permatell.xyz",
    ]);
    const saved = screen.getByRole("region", { name: "Saved" });
    expect(saved.querySelector("img")?.getAttribute("src")).toBe(PNG);
    // A recent site has no stored icon, so it keeps its letter.
    expect(screen.getByRole("region", { name: "Recent" }).querySelector("img")).toBeNull();
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

describe("BrowserView history", () => {
  it("shows where the user last was on a recent site", async () => {
    const { runtime } = fakeRuntime({
      saved: [],
      recent: ["https://recent.example"],
      history: [{ url: "https://recent.example/pomp/claim/72mVqAhoivaMzHOEVNRo6Kisy8avXCsjJJpitpM5mVQ", title: "Claim", at: Date.now() }],
    });
    mount({ runtime });
    expect(await screen.findByText(/^pomp › claim › … · /)).toBeTruthy();
  });

  it("opens from the start screen, lists pages by title under their host, and opens one", async () => {
    const browser = fakeBrowser();
    const now = Date.now();
    const { runtime } = fakeRuntime({
      saved: [],
      recent: ["https://a.example"],
      history: [
        { url: "https://a.example/two", title: "Two", at: now },
        { url: "https://a.example/one", title: "One", at: now - 1_000 },
        { url: "https://b.example/pools", title: "Pools", at: now - 2_000 },
      ],
    });
    mount({ browser: browser.port, runtime });

    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    expect(screen.getByRole("heading", { name: "History" })).toBeTruthy();
    // Two pages on a.example in a row fold into one row.
    const folded = screen.getByRole("button", { name: /a\.example/ });
    expect(folded.getAttribute("aria-expanded")).toBe("false");
    expect(within(folded).getByText("2 pages")).toBeTruthy();
    expect(screen.getByText("b.example")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search history" }), { target: { value: "nothing" } });
    expect(screen.getByText("No matching pages.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search history" }), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /a\.example/ }));
    fireEvent.click(screen.getByRole("button", { name: /^One/ }));
    expect(browser.port.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://a.example/one" }));
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
  });

  it("closes history on the system back press", async () => {
    const { runtime } = fakeRuntime({ saved: [], recent: ["https://a.example"] });
    const { stack, onBack } = mount({ runtime });
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    act(() => {
      expect(stack.handle()).toBe(true);
    });
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("records the page's title with the visit", async () => {
    const browser = fakeBrowser();
    const { runtime, send } = fakeRuntime();
    mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false, title: "A page" });
    await waitFor(
      () => expect(send).toHaveBeenCalledWith({ type: "recordRecentSite", payload: { url: "https://a.example/page", title: "A page" } }),
      { timeout: 3_000 },
    );
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

  it("shows where on the site the page is after the host", async () => {
    const browser = fakeBrowser();
    mount({ browser: browser.port, initialUrl: "https://www.permatell.xyz/" });
    await browser.emit({
      kind: "navigation",
      url: "https://www.permatell.xyz/pomp/claim/72mVqAhoivaMzHOEVNRo6Kisy8avXCsjJJpitpM5mVQ",
      canGoBack: false,
      loading: false,
    });
    expect(screen.getByText("www.")).toBeTruthy();
    expect(screen.getByText("permatell.xyz")).toBeTruthy();
    expect(screen.getByText("› pomp › claim › …")).toBeTruthy();
  });

  it("records the origin as a recent site and saves it with the star", async () => {
    const browser = fakeBrowser();
    const { runtime, send } = fakeRuntime();
    mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false });
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "recordRecentSite", payload: { url: "https://a.example/page" } }),
      { timeout: 3_000 },
    );

    fireEvent.click(screen.getByLabelText("Save site"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "saveBrowserSite", payload: { url: "https://a.example/page" } }),
    );
  });

  it("records where a shortener redirects to, not the shortener", async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    const { runtime, send } = fakeRuntime();
    mount({ browser: browser.port, runtime, initialUrl: "https://t.co/abc" });
    await browser.emit({ kind: "navigation", url: "https://t.co/abc", canGoBack: false, loading: true });
    await browser.emit({ kind: "navigation", url: "https://t.co/abc", canGoBack: false, loading: false });
    await act(() => vi.advanceTimersByTimeAsync(100));
    await browser.emit({ kind: "navigation", url: "https://b.example/post", canGoBack: false, loading: true });
    await browser.emit({ kind: "navigation", url: "https://b.example/post", canGoBack: false, loading: false });
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    const recorded = send.mock.calls.flatMap(([message]) => (message.type === "recordRecentSite" ? [message] : []));
    expect(recorded).toEqual([{ type: "recordRecentSite", payload: { url: "https://b.example/post" } }]);
  });

  it("saves the page's icon with the site, only when it came from that site", async () => {
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    for (const [origin, payload] of [
      ["https://a.example", { url: "https://a.example/page", icon: PNG }],
      ["https://other.example", { url: "https://a.example/page" }],
    ] as const) {
      const browser = fakeBrowser();
      vi.mocked(browser.port.pageIcon).mockResolvedValue({ origin, dataUrl: PNG });
      const { runtime, send } = fakeRuntime();
      mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
      await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false });
      fireEvent.click(screen.getByLabelText("Save site"));
      await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "saveBrowserSite", payload }));
      cleanup();
    }
  });

  it("fills the star on tap, before the save lands, and empties it if the save fails", async () => {
    const browser = fakeBrowser();
    let failSave!: (error: Error) => void;
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "listBrowserSites") return { saved: [], recent: [], icons: {}, history: [] };
      if (type === "getConnectedApps") return [];
      if (type === "saveBrowserSite") return new Promise((_, reject) => (failSave = reject));
      return undefined;
    });
    const runtime = { send, onMessage: () => () => {} } as unknown as RuntimePort;
    mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false });

    fireEvent.click(screen.getByLabelText("Save site"));
    const star = screen.getByLabelText("Remove from saved sites");
    expect(star.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "saveBrowserSite" })));

    await act(async () => failSave(new Error("offline")));
    await waitFor(() => expect(screen.getByLabelText("Save site").getAttribute("aria-pressed")).toBe("false"));
  });

  it("still saves the site when reading its icon fails", async () => {
    const browser = fakeBrowser();
    vi.mocked(browser.port.pageIcon).mockRejectedValue(new Error("no view"));
    const { runtime, send } = fakeRuntime();
    mount({ browser: browser.port, runtime, initialUrl: "https://a.example/" });
    await browser.emit({ kind: "navigation", url: "https://a.example/page", canGoBack: false, loading: false });
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
      return type === "listBrowserSites" ? { saved: [], recent: [], icons: {} } : [];
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

describe("BrowserView full address", () => {
  const URL_WITH_PARTS = "https://app.permaswap.network/swap/AR-USDC?ref=8f3k2c#confirm";

  async function openPage() {
    const browser = fakeBrowser();
    const mounted = mount({ browser: browser.port, initialUrl: URL_WITH_PARTS });
    await browser.emit({ kind: "navigation", url: URL_WITH_PARTS, canGoBack: true, loading: false });
    return { browser, ...mounted };
  }

  it("puts the site in its own place in the bar, after its subdomain", async () => {
    await openPage();
    expect(screen.getByText("app.")).toBeTruthy();
    expect(screen.getByText("permaswap.network").className).toContain("font-semibold");
  });

  it("peeks at the full address while the bar is held, over a hidden page, without starting an edit", async () => {
    const { browser } = await openPage();
    const bar = screen.getByLabelText(/^Address, app\.permaswap\.network/);

    fireEvent.pointerDown(bar);
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(screen.getByText("AR-USDC")).toBeTruthy();
    await waitFor(() => expect(browser.port.setHidden).toHaveBeenLastCalledWith(true));

    fireEvent.pointerUp(bar);
    fireEvent.click(bar);
    expect(screen.queryByText("AR-USDC")).toBeNull();
    expect(screen.queryByLabelText("Address")).toBeNull();
    await waitFor(() => expect(browser.port.setHidden).toHaveBeenLastCalledWith(false));
  });

  it("still edits on a short tap", async () => {
    await openPage();
    const bar = screen.getByLabelText(/^Address, app\.permaswap\.network/);
    fireEvent.pointerDown(bar);
    fireEvent.pointerUp(bar);
    fireEvent.click(bar);
    expect(screen.getByLabelText("Address")).toBeTruthy();
  });

  it("lists the address's parts from the info button and copies the address as loaded", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openPage();

    fireEvent.click(screen.getByLabelText("Show full address"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Subdomain")).toBeTruthy();
    expect(within(sheet).getByText("AR-USDC")).toBeTruthy();
    expect(within(sheet).getByText("ref")).toBeTruthy();
    expect(within(sheet).getByText("confirm")).toBeTruthy();

    fireEvent.click(within(sheet).getByText("Copy address"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_WITH_PARTS));
  });

  it("closes the sheet on the system back press before going back in the page", async () => {
    const { browser, stack } = await openPage();
    fireEvent.click(screen.getByLabelText("Show full address"));
    await screen.findByRole("dialog");

    act(() => {
      expect(stack.handle()).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(browser.port.goBack).not.toHaveBeenCalled();
  });
});
